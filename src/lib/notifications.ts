import type { DeliveryMode } from "./catalog";
import { trackingLink } from "./tracking-auth";
import { notificationMessage } from "./email-templates";
import { ResendError, sendResendEmail } from "./resend";

export { notificationMessage };

export async function sendNotifications(env: AppEnv) {
  if (env.EMAIL_ENABLED !== "true" || env.CHECKOUT_MODE !== "live" || !env.RESEND_API_KEY || !env.EMAIL_FROM || !env.TRACKING_LINK_SECRET) return;
  const now = Date.now();
  const { results } = await env.DB.prepare("SELECT n.id,n.order_id,n.kind,n.card_position,n.attempts,n.created_at,o.email,o.delivery_mode,c.sent_date FROM notification_outbox n JOIN orders o ON o.id=n.order_id LEFT JOIN order_cards c ON c.order_id=n.order_id AND c.position=n.card_position WHERE n.status IN ('pending','sending') AND n.available_at<=? AND n.attempts<5 AND o.status='paid' AND o.payment_mode='live' ORDER BY n.created_at LIMIT 20")
    .bind(now).all<{ id: string; order_id: string; kind: string; card_position: number | null; attempts: number; created_at: number; email: string; delivery_mode: DeliveryMode; sent_date: string | null }>();
  for (const row of results) {
    const lease = crypto.randomUUID();
    const claim = await env.DB.prepare("UPDATE notification_outbox SET status='sending',lease_id=?,attempts=attempts+1,available_at=? WHERE id=? AND created_at=? AND status IN ('pending','sending') AND available_at<=? AND attempts<5 AND (kind!='shipped' OR EXISTS(SELECT 1 FROM order_cards c WHERE c.order_id=notification_outbox.order_id AND c.position=notification_outbox.card_position AND c.state='sent' AND c.sent_date=?))")
      .bind(lease, Date.now() + 300000, row.id, row.created_at, Date.now(), row.sent_date).run();
    if (!claim.meta.changes) continue;
    try {
      // Keep the signed URL identical on retries: Resend requires the same body for a given key.
      const message = notificationMessage(row.kind, row.order_id.slice(0, 8).toUpperCase(), await trackingLink(env, row.order_id, row.created_at), row.card_position ?? undefined, row.sent_date ?? undefined, row.delivery_mode);
      const messageId = await sendResendEmail(env.RESEND_API_KEY, {
        ...message, from: "Les aventures de mon doudou et ma tétine <" + env.EMAIL_FROM + ">",
        to: [row.email], ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
      }, "notification/" + row.id);
      await env.DB.prepare("UPDATE notification_outbox SET status='sent',sent_at=?,provider_id=?,error_code=NULL WHERE id=? AND lease_id=?")
        .bind(Date.now(), messageId, row.id, lease).run();
    } catch (error) {
      const code = error instanceof ResendError ? error.code : "SEND_FAILED";
      const permanent = error instanceof ResendError && !error.retryable;
      const delay = Math.max(Math.min(3600000, 300000 * 2 ** row.attempts), error instanceof ResendError ? error.retryAfterMs : 0);
      await env.DB.prepare("UPDATE notification_outbox SET status=?,error_code=?,available_at=? WHERE id=? AND lease_id=?")
        .bind(permanent || row.attempts >= 4 ? "failed" : "pending", code, Date.now() + delay, row.id, lease).run();
      console.error(JSON.stringify({ event: "notification_failed", code }));
    }
  }
  await env.DB.prepare("UPDATE notification_outbox SET status='failed',error_code='RETRY_EXHAUSTED' WHERE status='sending' AND attempts>=5 AND available_at<=?").bind(Date.now()).run();
}
