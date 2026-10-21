import Stripe from "stripe";
import { books, PRICE_CENTS } from "./catalog";
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
  const body = await limitedBody(request, 11 * 1024 * 1024);
  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new InputError("Formulaire illisible.");
  }
  const data = validateOrder(form);
  const pacifier = await validatePhoto(form.get("pacifierPhoto"), true);
  const child = await validatePhoto(form.get("childPhoto"), false);
  const requestHash = await sha256(
    JSON.stringify(data) +
      (await sha256(pacifier!.bytes)) +
      (child ? await sha256(child.bytes) : ""),
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
  const childKey = child ? `orders/${id}/child` : null;
  // Record the intent first: interrupted uploads are covered by the retention task.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO orders
  (id,request_hash,access_token,book,child_name,first_name,last_name,email,address,address_extra,postal_code,city,notes,pacifier_key,child_key,amount_cents,payment_mode,consent_version,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      requestHash,
      token,
      data.book,
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
      childKey,
      PRICE_CENTS,
      env.CHECKOUT_MODE,
      "2026-10-17",
      Date.now(),
    )
    .run();
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?")
    .bind(id)
    .first<StoredOrder>();
  if (!order || order.request_hash !== requestHash)
    throw new InputError(
      "Cette commande est déjà en cours de préparation.",
      409,
    );
  await photos.put(pacifierKey, pacifier!.bytes, {
    httpMetadata: { contentType: pacifier!.mime },
  });
  if (child && childKey)
    await photos.put(childKey, child.bytes, {
      httpMetadata: { contentType: child.mime },
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
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: PRICE_CENTS,
            product_data: {
              name: books[data.book].title,
              description:
                "Livre papier personnalisé — livraison en France métropolitaine incluse",
            },
          },
        },
      ],
      success_url: `${origin}/confirmation`,
      cancel_url: `${origin}/personnaliser?annule=1&aventure=${data.book}`,
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
  if (!expired && session.payment_status !== "paid")
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
    "SELECT id,status FROM orders WHERE access_token = ?",
  )
    .bind(token)
    .first<{ id: string; status: string }>();
  if (!order) throw new InputError("Commande introuvable.", 404);
  return Response.json({
    status: order.status,
    reference: order.id.slice(0, 8).toUpperCase(),
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
