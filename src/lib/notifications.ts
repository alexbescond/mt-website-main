import { trackingLink } from "./tracking-auth";
import { displayDate } from "./tracking-model";
import { ResendError, sendResendEmail } from "./resend";

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
export function notificationMessage(kind: string, reference: string, link: string, position?: number, date?: string) {
  const subject = kind === "shipped" ? "Votre carte " + position + " a pris la route !" :
    kind === "access" ? "Votre lien pour suivre les cartes" : "Le voyage de son compagnon commence";
  const copy = kind === "shipped" ?
    "La carte " + position + " de votre commande " + reference + " a été expédiée le " + displayDate(date!) + ". La date de réception dépend de l’acheminement postal." :
    kind === "access" ? "Retrouvez l’avancement de chaque carte de votre commande " + reference + "." :
    "Votre paiement est confirmé et votre commande " + reference + " est enregistrée. Vous pouvez suivre la préparation et l’expédition de chaque carte.";
  const footer = "Ce lien privé est valable 30 jours. Gardez-le pour vous. Vous pourrez demander un nouveau lien depuis la page de suivi.";
  return {
    subject,
    text: subject + "\n\n" + copy + "\n\nSuivre mes cartes : " + link + "\n\n" + footer + "\n\nLes aventures de mon doudou et ma tétine",
    html: '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + escapeHtml(subject) +
      '</title></head><body style="margin:0;background:#faf7f0;color:#293e36;font-family:Arial,sans-serif"><table role="presentation" style="width:100%;padding:32px 16px"><tr><td align="center"><table role="presentation" style="width:100%;max-width:560px;background:#fff;border-radius:20px;padding:32px"><tr><td><p style="font-size:12px;letter-spacing:2px">DES NOUVELLES DE SON VOYAGE</p><h1 style="font-size:28px">' +
      escapeHtml(subject) + '</h1><p style="font-size:16px;line-height:1.7">' + escapeHtml(copy) +
      '</p><p style="margin:32px 0"><a style="background:#294f42;color:#fff;padding:16px 24px;border-radius:8px;text-decoration:none;display:inline-block" href="' +
      escapeHtml(link) + '">Suivre mes cartes</a></p><p style="font-size:13px;line-height:1.6">' + escapeHtml(footer) +
      '</p><p style="font-size:13px">Les aventures de mon doudou et ma tétine</p></td></tr></table></td></tr></table></body></html>',
  };
}
export async function sendNotifications(env: AppEnv) {
  if (env.EMAIL_ENABLED !== "true" || env.CHECKOUT_MODE !== "live" || !env.RESEND_API_KEY || !env.EMAIL_FROM || !env.TRACKING_LINK_SECRET) return;
  const now = Date.now();
  const { results } = await env.DB.prepare("SELECT n.id,n.order_id,n.kind,n.card_position,n.attempts,n.created_at,o.email,c.sent_date FROM notification_outbox n JOIN orders o ON o.id=n.order_id LEFT JOIN order_cards c ON c.order_id=n.order_id AND c.position=n.card_position WHERE n.status IN ('pending','sending') AND n.available_at<=? AND n.attempts<5 AND o.status='paid' AND o.payment_mode='live' ORDER BY n.created_at LIMIT 20")
    .bind(now).all<{ id: string; order_id: string; kind: string; card_position: number | null; attempts: number; created_at: number; email: string; sent_date: string | null }>();
  for (const row of results) {
    const lease = crypto.randomUUID();
    const claim = await env.DB.prepare("UPDATE notification_outbox SET status='sending',lease_id=?,attempts=attempts+1,available_at=? WHERE id=? AND status IN ('pending','sending') AND available_at<=? AND attempts<5")
      .bind(lease, Date.now() + 300000, row.id, Date.now()).run();
    if (!claim.meta.changes) continue;
    try {
      // Keep the signed URL identical on retries: Resend requires the same body for a given key.
      const message = notificationMessage(row.kind, row.order_id.slice(0, 8).toUpperCase(), await trackingLink(env, row.order_id, row.created_at), row.card_position ?? undefined, row.sent_date ?? undefined);
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
