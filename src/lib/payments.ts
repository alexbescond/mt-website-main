import Stripe from "stripe";
import { paidOrderStatements } from "./tracking";
import { companions, SEND_INTERVAL_DAYS, deliveryLabel } from "./catalog";
import { COUPON_UNAVAILABLE, couponPrice, normalizeCoupon } from "./coupons";
import {
  InputError,
  limitedBody,
  sha256,
  validateOrder,
  validatePhoto,
} from "./validation";
export function stripeClient(env: AppEnv) {
  return new Stripe(env.STRIPE_SECRET_KEY!, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 15000,
  });
}
export function checkoutAvailable(env: AppEnv, url: URL) {
  if (!env.PHOTOS) return false;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && url.origin !== env.SITE_ORIGIN) return false;
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) return false;
  if (env.CHECKOUT_MODE === "test")
    return !!env.STRIPE_SECRET_KEY?.startsWith("sk_test_");
  return (
    env.CHECKOUT_MODE === "live" &&
    env.LEGAL_APPROVED === "true" &&
    !!env.STRIPE_SECRET_KEY?.startsWith("sk_live_")
  );
}
type StoredOrder = {
  id: string;
  request_hash: string;
  access_token: string;
  stripe_checkout_url: string | null;
  stripe_session_id: string | null;
  status: string;
  amount_cents: number;
  subtotal_cents: number;
  coupon_id: string | null;
  coupon_label: string | null;
  coupon_percent_off: number;
  coupon_discount_cents: number;
  currency: string;
  payment_mode: string;
  created_at: number;
  pacifier_key: string | null;
  child_key: string | null;
  photos_deleted_at: number | null;
};
function checkoutResponse(
  order: Pick<StoredOrder, "access_token">,
  url: string,
  request: Request,
) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return Response.json(
    { url },
    {
      headers: {
        "Set-Cookie": `mt_order=${order.access_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`,
        "Cache-Control": "no-store",
      },
    },
  );
}
export async function createCheckout(request: Request, env: AppEnv) {
  const photos = env.PHOTOS;
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin)
    throw new InputError("Origine du formulaire invalide.", 403);
  if (!photos || !checkoutAvailable(env, url))
    throw new InputError("Les paiements ne sont pas encore ouverts.", 503);
  const { success } = await env.CHECKOUT_LIMITER.limit({
    key: request.headers.get("CF-Connecting-IP") || "local",
  });
  if (!success)
    throw new InputError(
      "Quelques instants de patience avant de réessayer.",
      429,
    );
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new InputError("Format de formulaire invalide.", 415);
  const body = await limitedBody(request, 6 * 1024 * 1024);
  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new InputError("Formulaire illisible.");
  }
  const data = { ...validateOrder(form), couponCode: normalizeCoupon(form.get("couponCode")) };
  if (form.has("childPhoto"))
    throw new InputError("Seule la photo de son compagnon est acceptée.");
  const pacifier = await validatePhoto(form.get("pacifierPhoto"), true);
  const requestHash = await sha256(
    JSON.stringify(data) + (await sha256(pacifier!.bytes)),
  );
  const existing = await env.DB.prepare("SELECT * FROM orders WHERE id = ?")
    .bind(data.attemptId)
    .first<StoredOrder>();
  if (existing) {
    if (existing.request_hash !== requestHash)
      throw new InputError(
        "Le formulaire a changé. Rechargez la page avant de réessayer.",
        409,
      );
    if (
      existing.status !== "pending" ||
      Date.now() - existing.created_at > 23 * 60 * 60 * 1000
    )
      throw new InputError(
        "Cette session est terminée. Commencez une nouvelle commande.",
        409,
      );
    if (existing.stripe_checkout_url)
      return checkoutResponse(existing, existing.stripe_checkout_url, request);
  }
  const id = data.attemptId;
  const token =
    existing?.access_token || crypto.randomUUID() + crypto.randomUUID();
  const pacifierKey = `orders/${id}/pacifier`;
  const promotion = !existing && data.couponCode
    ? await couponPrice(env, data.couponCode, data.email, data.quantity, data.deliveryMode, id)
    : null;
  const amountCents = existing?.amount_cents ?? promotion?.totalCents ?? data.amountCents;
  // A preview is advisory. Never charge more than the price the customer accepted.
  const expectedTotal = form.get("couponExpectedTotal");
  if (data.couponCode && expectedTotal !== null &&
      (typeof expectedTotal !== "string" || !/^\d+$/.test(expectedTotal) || Number(expectedTotal) !== amountCents))
    throw new InputError("Le montant a changé. Appliquez à nouveau votre code promo avant de continuer.", 409);
  // Record the intent first: interrupted uploads are covered by the retention task.
  // The conditional insert also reserves coupon usage atomically. Pending orders
  // hold their reservation until Stripe confirms expiration or payment.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO orders
  (id,request_hash,access_token,book,child_name,first_name,last_name,email,address,address_extra,postal_code,city,notes,pacifier_key,child_key,amount_cents,payment_mode,consent_version,created_at,companion_type,companion_name,product_type,card_quantity,unit_price_cents,card_adventures,send_interval_days,delivery_mode,subtotal_cents,coupon_id,coupon_label,coupon_percent_off,coupon_discount_cents,coupon_first_order)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
  ${promotion ? `WHERE EXISTS (${promotion.eligibility.sql} AND c.id=? AND c.percent_off=? AND c.first_order_only=?)` : ""}`,
  )
    .bind(
      id,
      requestHash,
      token,
      data.cardAdventures[0],
      data.childName,
      data.firstName,
      data.lastName,
      data.email,
      data.address,
      data.addressExtra,
      data.postalCode,
      data.city,
      data.notes,
      pacifierKey,
      null,
      amountCents,
      env.CHECKOUT_MODE,
      "2026-11-02",
      Date.now(),
      data.companion,
      data.companionName,
      "postcards",
      data.quantity,
      data.unitPriceCents,
      JSON.stringify(data.cardAdventures),
      SEND_INTERVAL_DAYS,
      data.deliveryMode,
      data.amountCents,
      promotion?.coupon.id ?? existing?.coupon_id ?? null,
      promotion?.coupon.label ?? existing?.coupon_label ?? null,
      promotion?.coupon.percent_off ?? existing?.coupon_percent_off ?? 0,
      promotion?.discountCents ?? existing?.coupon_discount_cents ?? 0,
      promotion?.coupon.first_order_only ?? 0,
      ...(promotion ? [...promotion.eligibility.values, promotion.coupon.id, promotion.coupon.percent_off, promotion.coupon.first_order_only] : []),
    )
    .run();
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?")
    .bind(id)
    .first<StoredOrder>();
  if (!order) throw new InputError(data.couponCode ? COUPON_UNAVAILABLE : "Cette commande est déjà en cours de préparation.", 409);
  if (order.request_hash !== requestHash)
    throw new InputError(
      "Cette commande est déjà en cours de préparation.",
      409,
    );
  await photos.put(pacifierKey, pacifier!.bytes, {
    httpMetadata: { contentType: pacifier!.mime },
  });
  const origin = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ? url.origin
    : env.SITE_ORIGIN;
  const stripe = stripeClient(env);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      locale: "fr",
      allowed_payment_method_types: ["card"],
      customer_email: data.email,
      client_reference_id: id,
      metadata: { order_id: id },
      line_items: [
        {
          // Price the discounted pack as a single item to avoid rounding a
          // discount per card (e.g. 3 grouped cards: €14.25 minus €1.43).
          quantity: order.coupon_id ? 1 : data.quantity,
          price_data: {
            currency: "eur",
            unit_amount: order.coupon_id ? order.amount_cents : data.unitPriceCents,
            product_data: {
              name: order.coupon_id
                ? `${data.quantity} carte${data.quantity > 1 ? "s" : ""} postale${data.quantity > 1 ? "s" : ""} personnalisée${data.quantity > 1 ? "s" : ""} — ${companions[data.companion].character}`
                : `Carte postale personnalisée — ${companions[data.companion].character}`,
              description:
                `${deliveryLabel(data.quantity, data.deliveryMode)} — frais de port inclus en France métropolitaine` +
                (order.coupon_id ? ` · Remise de ${order.coupon_percent_off} % incluse` : ""),
            },
          },
        },
      ],
      success_url: `${origin}/confirmation`,
      cancel_url: `${origin}/personnaliser?annule=1&aventure=${data.cardAdventures[0]}&compagnon=${data.companion}&cartes=${data.quantity}&envoi=${data.deliveryMode}`,
    },
    { idempotencyKey: `mt-checkout-${id}` },
  );
  if (!session.url || new URL(session.url).hostname !== "checkout.stripe.com")
    throw new Error("Stripe session URL missing");
  await env.DB.prepare(
    "UPDATE orders SET stripe_session_id = ?, stripe_checkout_url = ? WHERE id = ?",
  )
    .bind(session.id, session.url, id)
    .run();
  return checkoutResponse(order, session.url, request);
}
export async function stripeWebhook(request: Request, env: AppEnv) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)
    throw new InputError("Webhook indisponible.", 503);
  const signature = request.headers.get("stripe-signature");
  if (!signature) throw new InputError("Signature manquante.");
  const body = new TextDecoder().decode(
    await limitedBody(request, 1024 * 1024),
  );
  let event: Stripe.Event;
  try {
    event = await stripeClient(env).webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    throw new InputError("Signature invalide.");
  }
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.expired",
    ].includes(event.type)
  )
    return Response.json({ received: true });
  const session = event.data.object as Stripe.Checkout.Session;
  const id = session.metadata?.order_id;
  if (!id) return Response.json({ received: true });
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?")
    .bind(id)
    .first<StoredOrder>();
  // Retry unknown matching orders rather than acknowledging a lost payment.
  if (!order) throw new InputError("Commande temporairement introuvable.", 503);
  if (order.stripe_session_id !== session.id)
    throw new InputError("Session incohérente.", 409);
  if (event.livemode !== (order.payment_mode === "live"))
    throw new InputError("Mode de paiement incohérent.", 409);
  const expired = event.type === "checkout.session.expired";
  const freeCompleted = event.type === "checkout.session.completed" &&
    session.payment_status === "no_payment_required" && order.amount_cents === 0;
  if (!expired && session.payment_status !== "paid" && !freeCompleted)
    return Response.json({ received: true });
  if (
    !expired &&
    (session.amount_total !== order.amount_cents ||
      session.currency !== order.currency)
  )
    throw new InputError("Montant incohérent.", 409);
  // A single atomic batch makes repeated and out-of-order deliveries safe.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO stripe_events (id,order_id,type,received_at) VALUES (?,?,?,?)",
    ).bind(event.id, id, event.type, Date.now()),
    expired
      ? env.DB.prepare(
          "UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'",
        ).bind(id)
      : env.DB.prepare(
          "UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE id = ?",
        ).bind(Date.now(), id),
    ...(!expired ? paidOrderStatements(env, id, Date.now()) : []),
  ]);
  return Response.json({ received: true });
}
export async function orderStatus(request: Request, env: AppEnv) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("mt_order="))
    ?.slice(9);
  if (!token || !/^[a-f0-9-]{72}$/.test(token))
    throw new InputError("Commande introuvable.", 404);
  const order = await env.DB.prepare(
    "SELECT id,status,amount_cents FROM orders WHERE access_token = ?",
  )
    .bind(token)
    .first<{ id: string; status: string; amount_cents: number }>();
  if (!order) throw new InputError("Commande introuvable.", 404);
  return Response.json({
    status: order.status,
    reference: order.id.slice(0, 8).toUpperCase(),
    free: order.amount_cents === 0,
  });
}
export async function cleanupOrders(env: AppEnv) {
  // The public demo has no photo storage and never accepts an order.
  if (!env.PHOTOS) return;
  const now = Date.now();
  const day = 86400000;
  const { results } = await env.DB.prepare(
    `SELECT * FROM orders WHERE
  (status != 'paid' AND created_at < ?) OR (photos_deleted_at IS NULL AND created_at < ?) LIMIT 100`,
  )
    .bind(now - 7 * day, now - 90 * day)
    .all<StoredOrder>();
  for (const order of results) {
    const keys = [order.pacifier_key, order.child_key].filter(
      (k): k is string => !!k,
    );
    if (keys.length) await env.PHOTOS.delete(keys);
    if (order.status === "paid")
      await env.DB.prepare(
        "UPDATE orders SET pacifier_key = NULL, child_key = NULL, photos_deleted_at = ? WHERE id = ?",
      )
        .bind(now, order.id)
        .run();
    else
      await env.DB.batch([
        env.DB.prepare("DELETE FROM stripe_events WHERE order_id = ?").bind(
          order.id,
        ),
        env.DB.prepare(
          "DELETE FROM orders WHERE id = ? AND status != 'paid'",
        ).bind(order.id),
      ]);
  }
  console.log(
    JSON.stringify({ event: "retention_complete", processed: results.length }),
  );
}
