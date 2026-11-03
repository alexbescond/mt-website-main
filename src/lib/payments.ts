import Stripe from "stripe";
import { paidOrderStatements } from "./tracking";
import { companions, SEND_INTERVAL_DAYS, deliveryLabel } from "./catalog";
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
    return /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || "");
  return (
    env.CHECKOUT_MODE === "live" &&
    !local && url.protocol === "https:" &&
    env.EMAIL_ENABLED === "true" &&
    !!env.RESEND_API_KEY &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM || "") &&
    (env.ADMIN_PASSWORD?.length ?? 0) >= 24 &&
    (env.TRACKING_LINK_SECRET?.length ?? 0) >= 32 &&
    /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || "")
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
  coupon_email: string | null;
  coupon_discount_cents: number;
  discount_source: "legacy" | "stripe";
  currency: string;
  payment_mode: string;
  created_at: number;
  pacifier_key: string | null;
  child_key: string | null;
  photos_deleted_at: number | null;
  delivery_status: "pending" | "ready" | "needs_review";
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
  const data = validateOrder(form);
  // An older open form must not silently lose a discount it already displayed.
  if (form.get("couponCode"))
    throw new InputError("Les codes promo se saisissent désormais sur Stripe. Rechargez la page pour continuer.", 409);
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
  // Record the intent first: interrupted uploads are covered by the retention task.
  // Stripe applies promotions later, on its hosted checkout page.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO orders
  (id,request_hash,access_token,book,child_name,first_name,last_name,email,address,address_extra,postal_code,city,notes,pacifier_key,child_key,amount_cents,payment_mode,consent_version,created_at,companion_type,companion_name,product_type,card_quantity,unit_price_cents,card_adventures,send_interval_days,delivery_mode,subtotal_cents,delivery_status,discount_source)
  VALUES (?,?,?,?,?,'','','','','','','',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','stripe')`,
  )
    .bind(
      id,
      requestHash,
      token,
      data.cardAdventures[0],
      data.childName,
      data.notes,
      pacifierKey,
      null,
      data.amountCents,
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
    )
    .run();
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?")
    .bind(id)
    .first<StoredOrder>();
  if (!order) throw new InputError("Cette commande est déjà en cours de préparation.", 409);
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
      allow_promotion_codes: true,
      payment_method_collection: "if_required",
      shipping_address_collection: { allowed_countries: ["FR"] },
      custom_text: {
        shipping_address: { message: "Livraison en France métropolitaine uniquement (hors codes postaux 97 et 98). Indiquez le nom figurant sur la boîte aux lettres. Cette adresse sera utilisée pour toutes les cartes." },
      },
      client_reference_id: id,
      metadata: { order_id: id },
      line_items: [
        {
          quantity: data.quantity,
          price_data: {
            currency: "eur",
            unit_amount: data.unitPriceCents,
            product_data: {
              name: `Carte postale personnalisée — ${companions[data.companion].character}`,
              description:
                `${deliveryLabel(data.quantity, data.deliveryMode)} — frais de port inclus en France métropolitaine`,
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
    session.payment_status === "no_payment_required" && session.amount_total === 0;
  if (!expired && session.payment_status !== "paid" && !freeCompleted)
    return Response.json({ received: true });
  let discountCents = order.coupon_discount_cents;
  let promotionId: string | null = null;
  let promotionCode: string | null = null;
  let couponId: string | null = null;
  if (!expired) {
    if (session.currency !== order.currency)
      throw new InputError("Devise incohérente.", 409);
    if (order.discount_source === "stripe") {
      discountCents = session.total_details?.amount_discount ?? -1;
      // Stripe owns eligibility and rounding. Check the original server price
      // and reconcile its discount with the final total before fulfilment.
      if (session.amount_subtotal !== order.subtotal_cents ||
          !Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents > order.subtotal_cents ||
          session.total_details?.amount_tax !== 0 || (session.total_details.amount_shipping ?? 0) !== 0 ||
          session.amount_total !== order.subtotal_cents - discountCents)
        throw new InputError("Montant incohérent.", 409);
      if (order.status === "paid") {
        if (session.amount_total !== order.amount_cents || discountCents !== order.coupon_discount_cents)
          throw new InputError("Montant incohérent.", 409);
        return Response.json({ received: true });
      }
      if (discountCents > 0 || session.discounts?.length) {
        // Webhooks do not expand related objects. Resolve the promotion once
        // before the atomic write; an API failure leaves the event retryable.
        const expanded = await stripeClient(env).checkout.sessions.retrieve(session.id, {
          expand: ["discounts.promotion_code", "discounts.coupon"],
        });
        if (expanded.id !== session.id || expanded.amount_total !== session.amount_total ||
            expanded.discounts?.length !== 1)
          throw new InputError("Promotion temporairement invérifiable.", 503);
        const discount = expanded.discounts[0];
        const promotion = discount.promotion_code;
        promotionId = typeof promotion === "string" ? promotion : promotion?.id ?? null;
        promotionCode = typeof promotion === "object" ? promotion?.code ?? null : null;
        const coupon = discount.coupon ?? (typeof promotion === "object" ? promotion?.promotion.coupon : null);
        couponId = typeof coupon === "string" ? coupon : coupon?.id ?? null;
        if (!promotionId && !couponId)
          throw new InputError("Promotion temporairement invérifiable.", 503);
      }
    } else if (session.amount_total !== order.amount_cents) {
      // Sessions opened before the switch keep their agreed fixed price.
      throw new InputError("Montant incohérent.", 409);
    }
  }
  const delivery = stripeDelivery(session);
  // Keep the eligibility identity immutable even if Stripe returns a different
  // contact email. Hold such orders for review instead of releasing preparation.
  if (order.discount_source === "legacy" && order.coupon_email && delivery.email !== order.coupon_email) delivery.ready = false;
  // A single atomic batch makes repeated and out-of-order deliveries safe.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO stripe_events (id,order_id,type,received_at) VALUES (?,?,?,?)",
    ).bind(event.id, id, event.type, Date.now()),
    ...(!expired && order.discount_source === "stripe" ? [env.DB.prepare(
      `UPDATE orders SET amount_cents=?,coupon_discount_cents=?,stripe_promotion_code_id=?,stripe_promotion_code=?,stripe_coupon_id=?
       WHERE id=? AND status!='paid'`,
    ).bind(session.amount_total, discountCents, promotionId, promotionCode, couponId, id)] : []),
    ...(!expired ? [env.DB.prepare(
      `UPDATE orders SET recipient_name=?,email=?,address=?,address_extra=?,postal_code=?,city=?,country=?,delivery_status=?
       WHERE id=? AND delivery_status='pending' AND status!='paid'`,
    ).bind(delivery.name, delivery.email, delivery.address, delivery.extra, delivery.postalCode, delivery.city, delivery.country, delivery.ready ? "ready" : "needs_review", id)] : []),
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
    "SELECT id,status,amount_cents,delivery_status FROM orders WHERE access_token = ?",
  )
    .bind(token)
    .first<{ id: string; status: string; amount_cents: number; delivery_status: string }>();
  if (!order) throw new InputError("Commande introuvable.", 404);
  return Response.json({
    status: order.status,
    reference: order.id.slice(0, 8).toUpperCase(),
    free: order.amount_cents === 0,
    deliveryStatus: order.delivery_status,
  });
}

function stripeDelivery(session: Stripe.Checkout.Session) {
  // The pinned Stripe API exposes shipping under collected_information.
  // Never substitute the cardholder's billing address for the delivery address.
  const shipping = session.collected_information?.shipping_details;
  const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const delivery = {
    name: text(shipping?.name),
    email: text(session.customer_details?.email).toLowerCase(),
    address: text(shipping?.address?.line1),
    extra: text(shipping?.address?.line2),
    postalCode: text(shipping?.address?.postal_code),
    city: text(shipping?.address?.city),
    country: text(shipping?.address?.country),
  };
  const ready = !!delivery.name && !!delivery.address && !!delivery.city &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(delivery.email) &&
    delivery.country === "FR" && /^\d{5}$/.test(delivery.postalCode) &&
    !/^(97|98)/.test(delivery.postalCode) &&
    !Object.values(delivery).some(value => /[\u0000-\u001f\u007f]/.test(value));
  // A paid order must remain recorded even if delivery needs a manual review.
  return { ...delivery, ready };
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
