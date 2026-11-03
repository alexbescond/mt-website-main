import { getOrderPrice, isDeliveryMode, type DeliveryMode } from "./catalog";
import { InputError, sha256 } from "./validation";
import { limitAccess, readJson } from "./tracking-auth";

export const COUPON_UNAVAILABLE = "Ce code n’est pas disponible pour cette commande. Vérifiez le code et votre e-mail, ou retirez-le pour continuer.";
export function normalizeCoupon(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 80) throw new InputError("Vérifiez votre code promo.");
  const code = value.trim().toUpperCase();
  if (code && !/^[A-Z0-9-]{1,64}$/.test(code)) throw new InputError("Vérifiez votre code promo.");
  return code;
}
export interface Coupon {
  id: string;
  label: string;
  percent_off: number;
  first_order_only: number;
}

// Reused inside INSERT ... SELECT: eligibility and reservation happen in one
// write, so simultaneous requests cannot both claim a limited/first-order offer.
export async function couponEligibility(code: string, email: string, mode: string, attemptId = "") {
  const now = Date.now();
  return {
    sql: `SELECT c.* FROM coupons c WHERE c.code_hash=? AND c.enabled=1
      AND (c.allowed_email_hash IS NULL OR c.allowed_email_hash=?)
      AND (c.starts_at IS NULL OR c.starts_at<=?)
      AND (c.expires_at IS NULL OR c.expires_at>?)
      AND (c.first_order_only=0 OR NOT EXISTS (
        SELECT 1 FROM orders o WHERE (lower(trim(o.email))=? OR o.coupon_email=?) AND o.payment_mode=? AND o.id!=?
        AND (o.status='paid' OR (o.status='pending' AND o.coupon_first_order=1))))
      AND (c.max_redemptions IS NULL OR c.max_redemptions>(
        SELECT count(*) FROM orders o WHERE o.coupon_id=c.id AND o.payment_mode=?
        AND o.status IN ('pending','paid') AND o.id!=?))`,
    values: [await sha256(code), await sha256(email.trim().toLowerCase()), now, now,
      email.trim().toLowerCase(), email.trim().toLowerCase(), mode, attemptId, mode, attemptId],
  };
}
export async function couponPrice(env: AppEnv, code: string, email: string, quantity: number, delivery: DeliveryMode, attemptId = "") {
  const pack = getOrderPrice(quantity, delivery);
  const eligibility = await couponEligibility(code, email, env.CHECKOUT_MODE, attemptId);
  const coupon = await env.DB.prepare(eligibility.sql).bind(...eligibility.values).first<Coupon>();
  if (!coupon) throw new InputError(COUPON_UNAVAILABLE);
  const discountCents = Math.round(pack.totalCents * coupon.percent_off / 100);
  return { coupon, discountCents, totalCents: pack.totalCents - discountCents, eligibility };
}
export async function previewCoupon(request: Request, env: AppEnv) {
  const body = await readJson(request);
  await limitAccess(request, env, "coupon");
  if (env.CHECKOUT_MODE !== "test" && env.CHECKOUT_MODE !== "live")
    throw new InputError("Les codes promo seront disponibles à l’ouverture des commandes.", 503);
  const code = normalizeCoupon(body.code);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!code || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new InputError("Indiquez votre code promo et une adresse e-mail valide.");
  if (typeof body.quantity !== "number" || !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 5 || !isDeliveryMode(body.deliveryMode))
    throw new InputError("Choisissez de 1 à 5 cartes et un mode d’envoi valide.");
  const { coupon, discountCents, totalCents } = await couponPrice(env, code, email, body.quantity, body.quantity === 1 ? "weekly" : body.deliveryMode);
  return Response.json({ code, label: coupon.label, percentOff: coupon.percent_off, discountCents, totalCents },
    { headers: { "Cache-Control": "no-store" } });
}
