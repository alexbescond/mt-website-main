import { timingSafeEqual } from "node:crypto";
import { InputError, limitedBody, sha256 } from "./validation";

const DAY = 86400000;
export function cookieValue(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(name + "="))?.slice(name.length + 1);
}
export function privateCookie(request: Request, name: string, value: string, seconds: number) {
  return name + "=" + value + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + seconds +
    (new URL(request.url).protocol === "https:" ? "; Secure" : "");
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function requireOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new InputError("Origine de la requête invalide.", 403);
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  requireOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new InputError("Format de requête invalide.", 415);
  try {
    const value = JSON.parse(new TextDecoder().decode(await limitedBody(request, 4096)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("Requête illisible.");
  }
}
export async function limitAccess(request: Request, env: AppEnv, scope: string) {
  const result = await env.CHECKOUT_LIMITER.limit({ key: scope + ":" + (request.headers.get("CF-Connecting-IP") || "local") });
  if (!result.success) throw new InputError("Patientez quelques instants avant de réessayer.", 429);
}
export async function requireAdmin(request: Request, env: AppEnv) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 24 || env.CHECKOUT_MODE === "demo")
    throw new InputError("L’administration n’est pas encore activée.", 503);
  const token = cookieValue(request, "mt_admin");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new InputError("Connectez-vous à votre espace de préparation.", 401);
  const session = await env.DB.prepare("SELECT token_hash FROM admin_sessions WHERE token_hash=? AND credential_hash=? AND expires_at>?")
    .bind(await sha256(token), await sha256(env.ADMIN_PASSWORD), Date.now()).first();
  if (!session) throw new InputError("Votre session a expiré. Reconnectez-vous.", 401);
}
export async function adminLogin(request: Request, env: AppEnv) {
  const body = await readJson(request);
  await limitAccess(request, env, "admin-login");
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 24 || env.CHECKOUT_MODE === "demo")
    throw new InputError("L’administration n’est pas encore activée.", 503);
  const candidate = typeof body.password === "string" ? body.password : "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(candidate));
  const expected = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.ADMIN_PASSWORD));
  if (!timingSafeEqual(new Uint8Array(digest), new Uint8Array(expected))) throw new InputError("Identifiant incorrect.", 401);
  const token = randomToken();
  await env.DB.prepare("INSERT INTO admin_sessions VALUES (?,?,?)")
    .bind(await sha256(token), await sha256(env.ADMIN_PASSWORD), Date.now() + DAY / 2).run();
  return Response.json({ ok: true }, { headers: { "Set-Cookie": privateCookie(request, "mt_admin", token, 43200) } });
}
export async function adminLogout(request: Request, env: AppEnv) {
  requireOrigin(request);
  const token = cookieValue(request, "mt_admin");
  if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256(token)).run();
  return Response.json({ ok: true }, { headers: { "Set-Cookie": privateCookie(request, "mt_admin", "", 0) } });
}
async function linkKey(env: AppEnv) {
  if (!env.TRACKING_LINK_SECRET || env.TRACKING_LINK_SECRET.length < 32)
    throw new InputError("L’accès par e-mail n’est pas encore disponible.", 503);
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.TRACKING_LINK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function trackingLink(env: AppEnv, orderId: string, now = Date.now()) {
  const payload = orderId + "." + (now + 30 * DAY);
  const signature = await crypto.subtle.sign("HMAC", await linkKey(env), new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
  // The fragment is never sent in HTTP URLs or Referer headers.
  return env.SITE_ORIGIN + "/suivi#acces=" + payload + "." + hex;
}
export async function exchangeTrackingLink(request: Request, env: AppEnv) {
  const body = await readJson(request);
  await limitAccess(request, env, "tracking-access");
  const token = typeof body.token === "string" ? body.token : "";
  const match = /^([a-f0-9-]{36})\.(\d{13})\.([a-f0-9]{64})$/.exec(token);
  if (!match) throw new InputError("Ce lien est invalide ou a expiré.", 401);
  const [, orderId, expiry, signature] = match;
  const bytes = Uint8Array.from(signature.match(/../g)!, value => parseInt(value, 16));
  const valid = await crypto.subtle.verify("HMAC", await linkKey(env), bytes, new TextEncoder().encode(orderId + "." + expiry));
  if (!valid || Number(expiry) <= Date.now() || env.CHECKOUT_MODE === "demo")
    throw new InputError("Ce lien est invalide ou a expiré.", 401);
  const order = await env.DB.prepare("SELECT id FROM orders WHERE id=? AND status='paid' AND product_type='postcards' AND payment_mode=?")
    .bind(orderId, env.CHECKOUT_MODE).first();
  if (!order) throw new InputError("Ce lien est invalide ou a expiré.", 401);
  return createTrackingSession(request, env, orderId);
}
async function createTrackingSession(request: Request, env: AppEnv, orderId: string) {
  const session = randomToken();
  await env.DB.prepare("INSERT INTO tracking_sessions VALUES (?,?,?)")
    .bind(await sha256(session), orderId, Date.now() + 30 * DAY).run();
  return Response.json({ ok: true }, { headers: { "Set-Cookie": privateCookie(request, "mt_tracking", session, 30 * 86400) } });
}
export async function trackingAfterCheckout(request: Request, env: AppEnv) {
  await readJson(request);
  const token = cookieValue(request, "mt_order");
  if (!token || !/^[a-f0-9-]{72}$/.test(token) || env.CHECKOUT_MODE === "demo")
    throw new InputError("Ouvrez votre lien de suivi reçu par e-mail.", 401);
  const order = await env.DB.prepare("SELECT id FROM orders WHERE access_token=? AND created_at>? AND status='paid' AND product_type='postcards' AND payment_mode=?")
    .bind(token, Date.now() - DAY, env.CHECKOUT_MODE).first<{ id: string }>();
  if (!order) throw new InputError("Ouvrez votre lien de suivi reçu par e-mail.", 401);
  return createTrackingSession(request, env, order.id);
}
export async function trackingOrderId(request: Request, env: AppEnv) {
  if (env.CHECKOUT_MODE === "demo") throw new InputError("Aucune commande réelle en démonstration.", 401);
  const session = cookieValue(request, "mt_tracking");
  if (session && /^[a-f0-9]{64}$/.test(session)) {
    const row = await env.DB.prepare("SELECT order_id FROM tracking_sessions WHERE token_hash=? AND expires_at>?")
      .bind(await sha256(session), Date.now()).first<{ order_id: string }>();
    if (row) return row.order_id;
  }
  // Bootstrap the follow-up page directly after checkout, for at most 24 hours.
  const checkout = cookieValue(request, "mt_order");
  if (checkout && /^[a-f0-9-]{72}$/.test(checkout)) {
    const row = await env.DB.prepare("SELECT id FROM orders WHERE access_token=? AND created_at>? AND status='paid' AND payment_mode=?")
      .bind(checkout, Date.now() - DAY, env.CHECKOUT_MODE).first<{ id: string }>();
    if (row) return row.id;
  }
  throw new InputError("Ouvrez le lien reçu par e-mail pour retrouver vos cartes.", 401);
}
