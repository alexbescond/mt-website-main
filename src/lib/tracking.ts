import { InputError } from "./validation";
import { limitAccess, readJson, requireAdmin, trackingOrderId } from "./tracking-auth";
import { parisDate, type TrackingCard, type TrackingOrder } from "./tracking-model";
import type { CompanionId } from "./catalog";

interface StoredTrackingOrder {
  id: string;
  companion_type: CompanionId;
  companion_name: string;
  card_quantity: number;
  paid_at: number;
}
export interface AdminOrder extends TrackingOrder {
  id: string;
  parent: string;
  child: string;
  email: string;
  address: string;
  notes: string;
  hasPhoto: boolean;
  notifications: { kind: string; card_position: number | null; status: string; error_code: string | null }[];
}
function publicOrder(row: StoredTrackingOrder, cards: TrackingCard[]): TrackingOrder {
  return { reference: row.id.slice(0, 8).toUpperCase(), companion: row.companion_type,
    companionName: row.companion_name, quantity: row.card_quantity, paidAt: row.paid_at, cards };
}
async function cardsFor(env: AppEnv, id: string) {
  const { results } = await env.DB.prepare("SELECT position,adventure,state,planned_date,sent_date,version FROM order_cards WHERE order_id=? ORDER BY position")
    .bind(id).all<TrackingCard>();
  return results;
}
export async function customerTracking(request: Request, env: AppEnv) {
  const id = await trackingOrderId(request, env);
  const row = await env.DB.prepare("SELECT id,companion_type,companion_name,card_quantity,paid_at FROM orders WHERE id=? AND status='paid' AND product_type='postcards' AND payment_mode=?")
    .bind(id, env.CHECKOUT_MODE).first<StoredTrackingOrder>();
  if (!row) throw new InputError("Cette commande n’est pas disponible.", 404);
  return Response.json(publicOrder(row, await cardsFor(env, id)));
}
export function paidOrderStatements(env: AppEnv, id: string, now: number) {
  return [
    env.DB.prepare("INSERT OR IGNORE INTO order_cards(order_id,position,adventure,updated_at) SELECT orders.id,CAST(j.key AS INTEGER)+1,j.value,? FROM orders,json_each(orders.card_adventures) AS j WHERE orders.id=? AND status='paid' AND product_type='postcards'").bind(now, id),
    env.DB.prepare("INSERT OR IGNORE INTO notification_outbox(id,order_id,kind,available_at,created_at) SELECT id||'/confirmation',id,'confirmation',?,? FROM orders WHERE id=? AND status='paid' AND product_type='postcards'").bind(now, now, id),
  ];
}
export async function requestTrackingEmail(request: Request, env: AppEnv) {
  const body = await readJson(request);
  await limitAccess(request, env, "tracking-email");
  if (typeof body.email !== "string" || typeof body.reference !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254 ||
      !/^[a-f0-9]{8}$/i.test(body.reference.trim())) throw new InputError("Vérifiez votre e-mail et la référence de 8 caractères.");
  if (env.CHECKOUT_MODE !== "demo") {
    // Exact match on both fields; never reveal whether a customer/order exists.
    const { results } = await env.DB.prepare("SELECT id FROM orders WHERE lower(email)=? AND upper(substr(id,1,8))=? AND status='paid' AND product_type='postcards' AND payment_mode=? LIMIT 2")
      .bind(body.email.trim().toLowerCase(), body.reference.trim().toUpperCase(), env.CHECKOUT_MODE).all<{ id: string }>();
    if (results.length === 1) {
      const now = Date.now();
      const id = results[0].id;
      await env.DB.prepare("INSERT OR IGNORE INTO notification_outbox(id,order_id,kind,available_at,created_at) VALUES (?,?,'access',?,?)")
        .bind(id + "/access/" + Math.floor(now / 900000), id, now, now).run();
    }
  }
  return Response.json({ message: "Si ces informations correspondent à une commande, un lien vous sera envoyé. Pensez à vérifier vos courriers indésirables." }, { status: 202 });
}
export async function listAdminOrders(request: Request, env: AppEnv) {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const page = Math.min(10000, Math.max(0, Number(url.searchParams.get("page")) || 0));
  const search = (url.searchParams.get("search") || "").slice(0, 100).replace(/[%_\\]/g, "");
  const filter = url.searchParams.get("filter") || "active";
  const condition = filter === "sent" ? "NOT EXISTS(SELECT 1 FROM order_cards c WHERE c.order_id=o.id AND c.state!='sent')" :
    filter === "due" ? "EXISTS(SELECT 1 FROM order_cards c WHERE c.order_id=o.id AND c.state!='sent' AND (c.planned_date IS NULL OR c.planned_date<=?))" :
    filter === "all" ? "1=1" : "EXISTS(SELECT 1 FROM order_cards c WHERE c.order_id=o.id AND c.state!='sent')";
  const query = "SELECT o.* FROM orders o WHERE o.status='paid' AND o.product_type='postcards' AND o.payment_mode=? AND (o.id LIKE ? OR o.email LIKE ? OR o.last_name LIKE ?) AND " + condition + " ORDER BY o.created_at DESC,o.id LIMIT 21 OFFSET ?";
  const params: (string | number)[] = [env.CHECKOUT_MODE, "%" + search + "%", "%" + search + "%", "%" + search + "%"];
  if (filter === "due") params.push(parisDate());
  params.push(Math.floor(page) * 20);
  type Row = StoredTrackingOrder & { first_name: string; last_name: string; child_name: string; email: string; address: string; address_extra: string; postal_code: string; city: string; notes: string; pacifier_key: string | null };
  const { results } = await env.DB.prepare(query).bind(...params).all<Row>();
  const orders: AdminOrder[] = [];
  for (const row of results.slice(0, 20)) {
    const { results: notifications } = await env.DB.prepare("SELECT kind,card_position,status,error_code FROM notification_outbox WHERE order_id=? ORDER BY created_at DESC LIMIT 10")
      .bind(row.id).all<AdminOrder["notifications"][number]>();
    orders.push({ ...publicOrder(row, await cardsFor(env, row.id)), id: row.id,
      parent: row.first_name + " " + row.last_name, child: row.child_name, email: row.email,
      address: [row.first_name + " " + row.last_name, row.address, row.address_extra, row.postal_code + " " + row.city, "France"].filter(Boolean).join("\n"),
      notes: row.notes, hasPhoto: !!row.pacifier_key, notifications });
  }
  return Response.json({ orders, hasMore: results.length > 20, emailEnabled: env.CHECKOUT_MODE === "live" && env.EMAIL_ENABLED === "true" && !!env.RESEND_API_KEY && !!env.EMAIL_FROM && !!env.TRACKING_LINK_SECRET });
}
export async function updateCard(request: Request, env: AppEnv, orderId: string, position: number) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const state = body.state;
  if (!["queued", "preparing", "ready", "sent"].includes(String(state)) || !Number.isInteger(body.version) || Number(body.version) < 0)
    throw new InputError("Mise à jour invalide.");
  const sentDate = state === "sent" ? validateDate(body.sentDate) : null;
  if (sentDate && sentDate > parisDate()) throw new InputError("Une expédition réelle ne peut pas être dans le futur.");
  const paid = await env.DB.prepare("SELECT paid_at FROM orders WHERE id=? AND status='paid' AND payment_mode=?")
    .bind(orderId, env.CHECKOUT_MODE).first<{ paid_at: number }>();
  if (!paid) throw new InputError("Commande introuvable.", 404);
  if (sentDate && sentDate < parisDate(paid.paid_at)) throw new InputError("La date d’envoi précède le paiement.");
  const now = Date.now();
  const writeId = crypto.randomUUID();
  const statements = [
    env.DB.prepare(`UPDATE order_cards SET state=?,sent_date=?,version=version+1,updated_at=?,write_id=?
      WHERE order_id=? AND position=? AND version=? AND state!=?
      AND EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND o.status='paid' AND o.payment_mode=?)
      AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM order_cards earlier WHERE earlier.order_id=? AND earlier.position<? AND (earlier.state!='sent' OR earlier.sent_date>?)))
      AND (state!='sent' OR (
        NOT EXISTS(SELECT 1 FROM order_cards later WHERE later.order_id=? AND later.position>? AND later.state='sent')
        AND NOT EXISTS(SELECT 1 FROM notification_outbox n WHERE n.order_id=? AND n.card_position=? AND n.kind='shipped' AND n.status='sending')
      ))`)
      .bind(state, sentDate, now, writeId, orderId, position, body.version, state, env.CHECKOUT_MODE, sentDate, orderId, position, sentDate, orderId, position, orderId, position),
  ];
  if (state === "sent") {
    statements.push(
      env.DB.prepare("UPDATE order_cards SET planned_date=date(?,'+'||((position-?)*7)||' days'),version=version+1,updated_at=? WHERE order_id=? AND position>? AND state!='sent' AND EXISTS(SELECT 1 FROM order_cards changed WHERE changed.order_id=? AND changed.position=? AND changed.write_id=?)")
        .bind(sentDate, position, now, orderId, position, orderId, position, writeId),
      env.DB.prepare("INSERT OR IGNORE INTO notification_outbox(id,order_id,kind,card_position,available_at,created_at) SELECT order_id||'/shipped/'||position,order_id,'shipped',position,?,? FROM order_cards WHERE order_id=? AND position=? AND write_id=?")
        .bind(now, now, orderId, position, writeId),
    );
  } else {
    // Remove notifications never attempted; retain attempted ones for deduplication/audit.
    statements.push(
      env.DB.prepare("DELETE FROM notification_outbox WHERE order_id=? AND card_position=? AND kind='shipped' AND status IN ('pending','failed') AND attempts=0 AND EXISTS(SELECT 1 FROM order_cards changed WHERE changed.order_id=? AND changed.position=? AND changed.write_id=?)")
        .bind(orderId, position, orderId, position, writeId),
      env.DB.prepare("UPDATE notification_outbox SET status='failed',error_code='DISPATCH_CANCELLED',lease_id=NULL WHERE order_id=? AND card_position=? AND kind='shipped' AND status IN ('pending','failed') AND EXISTS(SELECT 1 FROM order_cards changed WHERE changed.order_id=? AND changed.position=? AND changed.write_id=?)")
        .bind(orderId, position, orderId, position, writeId),
    );
  }
  const result = await env.DB.batch(statements);
  if (!result[0].meta.changes) throw new InputError("Modification impossible. Actualisez le tableau et vérifiez les dates : expédiez les cartes dans l’ordre et annulez les expéditions en commençant par la dernière. Si un e-mail est en cours d’envoi, réessayez dans quelques instants.", 409);
  return Response.json({ ok: true });
}
function validateDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
      new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value)
    throw new InputError("Choisissez une date valide.");
  return value;
}
export async function scheduleOrder(request: Request, env: AppEnv, orderId: string) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const date = validateDate(body.date);
  if (date < parisDate() || !Number.isInteger(body.version)) throw new InputError("Choisissez aujourd’hui ou une date future.");
  const writeId = crypto.randomUUID();
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE order_cards SET planned_date=?,version=version+1,write_id=? WHERE order_id=? AND position=1 AND version=? AND state!='sent' AND EXISTS(SELECT 1 FROM orders WHERE id=order_id AND status='paid' AND payment_mode=?)")
      .bind(date, writeId, orderId, body.version, env.CHECKOUT_MODE),
    env.DB.prepare("UPDATE order_cards SET planned_date=date(?,'+'||((position-1)*7)||' days'),version=version+1 WHERE order_id=? AND position>1 AND state!='sent' AND EXISTS(SELECT 1 FROM order_cards first WHERE first.order_id=? AND first.position=1 AND first.write_id=?)")
      .bind(date, orderId, orderId, writeId),
  ]);
  if (!result[0].meta.changes) throw new InputError("Le planning a changé ou le premier envoi est déjà parti. Actualisez le tableau.", 409);
  return Response.json({ ok: true });
}
export async function adminPhoto(request: Request, env: AppEnv, orderId: string) {
  await requireAdmin(request, env);
  const row = await env.DB.prepare("SELECT pacifier_key FROM orders WHERE id=? AND status='paid' AND payment_mode=?")
    .bind(orderId, env.CHECKOUT_MODE).first<{ pacifier_key: string | null }>();
  const object = row?.pacifier_key ? await env.PHOTOS?.get(row.pacifier_key) : null;
  if (!object) throw new InputError("Cette photo n’est plus disponible.", 404);
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Content-Disposition": 'inline; filename="compagnon"', "Cache-Control": "private, no-store" } });
}
export async function retryNotifications(request: Request, env: AppEnv, orderId: string) {
  await requireAdmin(request, env);
  await readJson(request);
  await env.DB.prepare("UPDATE notification_outbox SET status='pending',attempts=0,available_at=?,lease_id=NULL,error_code=NULL WHERE order_id=? AND status='failed' AND (error_code IS NULL OR error_code!='DISPATCH_CANCELLED') AND EXISTS(SELECT 1 FROM orders WHERE id=order_id AND payment_mode=?)")
    .bind(Date.now(), orderId, env.CHECKOUT_MODE).run();
  return Response.json({ ok: true });
}
