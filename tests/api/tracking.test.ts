/// <reference types="@cloudflare/vitest-plugin/types" />
import delivery from "../../migrations/0005_delivery_mode.sql?raw";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import base from "../../migrations/0001_orders.sql?raw";
import companions from "../../migrations/0002_companions.sql?raw";
import postcards from "../../migrations/0003_postcards.sql?raw";
import stripeDelivery from "../../migrations/0006_stripe_delivery.sql?raw";
import tracking from "../../migrations/0004_tracking.sql?raw";
import { api } from "../../src/lib/api";
import { paidOrderStatements } from "../../src/lib/tracking";
import { trackingLink } from "../../src/lib/tracking-auth";
import { notificationMessage, sendNotifications } from "../../src/lib/notifications";
import { addDays, parisDate } from "../../src/lib/tracking-model";

const origin = "https://les-aventures-de-doudou-tetine.com";
const adminPassword = "fixture-admin-password-for-local-tests";
const bindings: AppEnv = { ...env, CHECKOUT_MODE: "test", EMAIL_ENABLED: "false", EMAIL_FROM: "bonjour@example.com", EMAIL_REPLY_TO: "",
  ADMIN_PASSWORD: adminPassword, TRACKING_LINK_SECRET: "fixture-tracking-secret-for-local-tests-only",
  CHECKOUT_LIMITER: { limit: async () => ({ success: true }) } };
beforeEach(async () => {
  await env.DB.batch([base, companions, postcards, tracking, delivery, stripeDelivery].join("\n").split(";").map(s => s.trim()).filter(Boolean).map(s => env.DB.prepare(s)));
});
afterEach(async () => { vi.restoreAllMocks(); await reset(); });
function call(path: string, body?: unknown, cookie?: string, custom = bindings, requestOrigin = origin) {
  return api(new Request(origin + path, { method: body === undefined ? "GET" : "POST",
    headers: { Origin: requestOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), custom);
}
async function paidOrder(mode = "test") {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO orders(id,request_hash,access_token,book,child_name,first_name,last_name,email,address,postal_code,city,amount_cents,payment_mode,consent_version,created_at,paid_at,status,product_type,card_quantity,card_adventures,companion_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, "hash", crypto.randomUUID() + crypto.randomUUID(), "ski", "Camille", "Alex", "Martin", "parent@example.com", "12 rue des Nuages", "75001", "Paris", 1650, mode, "test", Date.now(), Date.now(), "paid", "postcards", 3, '["ski","tropiques","espace"]', "<script>Lapinou</script>").run();
  await env.DB.batch(paidOrderStatements(bindings, id, Date.now()));
  return id;
}
async function admin(custom = bindings) {
  const response = await call("/api/admin/login", { password: adminPassword }, undefined, custom);
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function access(id: string, custom = bindings) {
  const link = await trackingLink(custom, id);
  const response = await call("/api/tracking/access", { token: link.split("#acces=")[1] }, undefined, custom);
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
it("creates one itinerary and one confirmation despite retries, and keeps preparation progress", async () => {
  const id = await paidOrder();
  await env.DB.prepare("UPDATE order_cards SET state='preparing' WHERE order_id=? AND position=1").bind(id).run();
  await env.DB.batch(paidOrderStatements(bindings, id, Date.now()));
  expect((await env.DB.prepare("SELECT count(*) AS n FROM order_cards").first())?.n).toBe(3);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox").first())?.n).toBe(1);
  expect((await env.DB.prepare("SELECT state FROM order_cards WHERE position=1").first())?.state).toBe("preparing");
});
it("shows the full Stripe recipient in admin search and blocks preparation for addresses needing review", async () => {
  const id = await paidOrder();
  const cookie = await admin();
  await env.DB.prepare("UPDATE orders SET first_name='',last_name='',recipient_name='Alex Marie Dupont',delivery_status='needs_review' WHERE id=?").bind(id).run();
  const response = await call("/api/admin/orders?search=Dupont", undefined, cookie);
  const body = await response.json() as { orders: { parent: string; address: string; deliveryStatus: string }[] };
  expect(body.orders).toHaveLength(1);
  expect(body.orders[0]).toMatchObject({ parent: "Alex Marie Dupont", deliveryStatus: "needs_review" });
  expect(body.orders[0].address).toContain("Alex Marie Dupont\n12 rue des Nuages");
  expect((await call(`/api/admin/orders/${id}/cards/1`, { state: "preparing", version: 0 }, cookie)).status).toBe(409);
  expect((await call(`/api/admin/orders/${id}/schedule`, { date: parisDate(), version: 0 }, cookie)).status).toBe(409);
  expect((await env.DB.prepare("SELECT state,planned_date FROM order_cards WHERE order_id=? AND position=1").bind(id).first()))
    .toEqual({ state: "queued", planned_date: null });
});
it("requires authentication, rejects cross-origin mutations, and invalidates logged-out and rotated admin sessions", async () => {
  const id = await paidOrder();
  expect((await call("/api/admin/orders")).status).toBe(401);
  expect((await call("/api/admin/orders/" + id + "/photo")).status).toBe(401);
  expect((await call("/api/admin/login", { password: "bad" })).status).toBe(401);
  const cookie = await admin();
  expect((await call("/api/admin/orders", undefined, cookie)).status).toBe(200);
  expect((await call("/api/admin/orders/" + id + "/cards/1", { state: "preparing", version: 0 }, cookie, bindings, "https://evil.example")).status).toBe(403);
  expect((await call("/api/admin/orders", undefined, cookie, { ...bindings, ADMIN_PASSWORD: "another-fixture-password-long-enough" })).status).toBe(401);
  await call("/api/admin/logout", {}, cookie);
  expect((await call("/api/admin/orders", undefined, cookie)).status).toBe(401);
});
it("uses signed expiring links and hashed sessions; customer API omits address, email, child and photo keys", async () => {
  const id = await paidOrder();
  expect((await call("/api/tracking")).status).toBe(401);
  const cookie = await access(id);
  const response = await call("/api/tracking", undefined, cookie);
  const body = await response.json() as Record<string, unknown>;
  expect(body.reference).toBe(id.slice(0, 8).toUpperCase());
  for (const key of ["email", "address", "child_name", "pacifier_key", "id", "access_token"]) expect(body).not.toHaveProperty(key);
  expect(body.cards).toHaveLength(3);
  const saved = await env.DB.prepare("SELECT token_hash FROM tracking_sessions").first<{ token_hash: string }>();
  expect(saved?.token_hash).not.toBe(cookie.split("=")[1]);
  const expired = await trackingLink(bindings, id, Date.now() - 31 * 86400000);
  expect((await call("/api/tracking/access", { token: expired.split("#acces=")[1] })).status).toBe(401);
  const token = (await trackingLink(bindings, id)).split("#acces=")[1];
  expect((await call("/api/tracking/access", { token: token.slice(0, -1) + (token.endsWith("0") ? "1" : "0") })).status).toBe(401);
  expect((await call("/api/tracking/access", { token }, undefined, { ...bindings, CHECKOUT_MODE: "live" })).status).toBe(401);
  await env.DB.prepare("UPDATE tracking_sessions SET expires_at=0").run();
  expect((await call("/api/tracking", undefined, cookie)).status).toBe(401);
});
it("plans dates, records actual dispatches atomically, rejects repeats and schedules the next cards seven calendar days later", async () => {
  const id = await paidOrder();
  const cookie = await admin();
  const path = "/api/admin/orders/" + id;
  const today = parisDate();
  expect((await call(path + "/schedule", { date: today, version: 0 }, cookie)).status).toBe(200);
  expect((await call(path + "/cards/1", { state: "preparing", version: 1 }, cookie)).status).toBe(200);
  expect((await call(path + "/cards/1", { state: "ready", version: 2 }, cookie)).status).toBe(200);
  expect((await call(path + "/cards/1", { state: "sent", version: 3, sentDate: addDays(today, 1) }, cookie)).status).toBe(400);
  const results = await Promise.all([
    call(path + "/cards/1", { state: "sent", version: 3, sentDate: today }, cookie),
    call(path + "/cards/1", { state: "sent", version: 3, sentDate: today }, cookie),
  ]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const cards = (await env.DB.prepare("SELECT * FROM order_cards WHERE order_id=? ORDER BY position").bind(id).all()).results;
  expect(cards[0]).toMatchObject({ state: "sent", sent_date: today });
  expect(cards[1].planned_date).toBe(addDays(today, 7));
  expect(cards[2].planned_date).toBe(addDays(today, 14));
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='shipped'").first())?.n).toBe(1);
  expect((await call(path + "/schedule", { date: today, version: 4 }, cookie)).status).toBe(409);
  await env.DB.prepare("UPDATE order_cards SET state='ready' WHERE order_id=? AND position=3").bind(id).run();
  expect((await call(path + "/cards/3", { state: "sent", version: cards[2].version, sentDate: today }, cookie)).status).toBe(409);
  expect(addDays("2026-03-25", 7)).toBe("2026-04-01");
  expect(parisDate(Date.parse("2026-06-01T22:30:00Z"))).toBe("2026-06-02");
});
it("allows direct status selection and rollback, clearing dispatch dates and unattempted notifications atomically", async () => {
  const id = await paidOrder();
  const cookie = await admin();
  const path = "/api/admin/orders/" + id + "/cards/1";
  const today = parisDate();
  const card = () => env.DB.prepare("SELECT state,sent_date,version FROM order_cards WHERE order_id=? AND position=1").bind(id).first();
  expect((await call(path, { state: "ready", version: 0 }, cookie)).status).toBe(200);
  expect((await call(path, { state: "preparing", version: 1 }, cookie)).status).toBe(200);
  expect((await call(path, { state: "queued", version: 2 }, cookie)).status).toBe(200);
  expect((await call(path, { state: "sent", version: 3, sentDate: today }, cookie)).status).toBe(200);
  expect((await call(path, { state: "queued", version: 3 }, cookie)).status).toBe(409);
  expect(await card()).toMatchObject({ state: "sent", sent_date: today, version: 4 });
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='shipped'").first())?.n).toBe(1);
  expect((await call(path, { state: "ready", version: 4 }, cookie)).status).toBe(200);
  expect(await card()).toMatchObject({ state: "ready", sent_date: null, version: 5 });
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='shipped'").first())?.n).toBe(0);
  expect((await call(path, { state: "sent", version: 5, sentDate: today }, cookie)).status).toBe(200);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='shipped'").first())?.n).toBe(1);
  expect((await call(path, { state: "invalid", version: 6 }, cookie)).status).toBe(400);
});
it("requires rolling back later dispatches first and waits for in-flight notifications", async () => {
  const id = await paidOrder();
  const cookie = await admin();
  const path = "/api/admin/orders/" + id + "/cards/";
  const today = parisDate();
  expect((await call(path + 1, { state: "sent", version: 0, sentDate: today }, cookie)).status).toBe(200);
  expect((await call(path + 2, { state: "sent", version: 1, sentDate: today }, cookie)).status).toBe(200);
  expect((await call(path + 1, { state: "queued", version: 1 }, cookie)).status).toBe(409);
  expect((await call(path + 2, { state: "ready", version: 2 }, cookie)).status).toBe(200);
  await env.DB.prepare("UPDATE notification_outbox SET status='sending',attempts=1 WHERE kind='shipped'").run();
  expect((await call(path + 1, { state: "queued", version: 1 }, cookie)).status).toBe(409);
  await env.DB.prepare("UPDATE notification_outbox SET status='pending' WHERE kind='shipped'").run();
  expect((await call(path + 1, { state: "queued", version: 1 }, cookie)).status).toBe(200);
  await call("/api/admin/orders/" + id + "/notifications/retry", {}, cookie);
  expect(await env.DB.prepare("SELECT status,error_code FROM notification_outbox WHERE kind='shipped'").first())
    .toMatchObject({ status: "failed", error_code: "DISPATCH_CANCELLED" });
  expect((await call(path + 1, { state: "sent", version: 2, sentDate: today }, cookie)).status).toBe(200);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='shipped'").first())?.n).toBe(1);
});
it("keeps delivered notification history without sending duplicates after a correction", async () => {
  const id = await paidOrder();
  const cookie = await admin();
  const path = "/api/admin/orders/" + id + "/cards/1";
  expect((await call(path, { state: "sent", version: 0, sentDate: parisDate() }, cookie)).status).toBe(200);
  await env.DB.prepare("UPDATE notification_outbox SET status='sent',attempts=1 WHERE kind='shipped'").run();
  expect((await call(path, { state: "preparing", version: 1 }, cookie)).status).toBe(200);
  expect((await call(path, { state: "sent", version: 2, sentDate: parisDate() }, cookie)).status).toBe(200);
  const notifications = await env.DB.prepare("SELECT status FROM notification_outbox WHERE kind='shipped'").all();
  expect(notifications.results).toEqual([{ status: "sent" }]);
});
it("isolates live and test orders and only permits the paid order to be followed", async () => {
  const id = await paidOrder("live");
  const cookie = await admin();
  const response = await call("/api/admin/orders", undefined, cookie);
  expect((await response.json() as { orders: unknown[] }).orders).toEqual([]);
  const link = await trackingLink(bindings, id);
  expect((await call("/api/tracking/access", { token: link.split("#acces=")[1] })).status).toBe(401);
  await env.DB.prepare("UPDATE orders SET payment_mode='test',status='pending' WHERE id=?").bind(id).run();
  expect((await call("/api/tracking/access", { token: link.split("#acces=")[1] })).status).toBe(401);
});
it("opens a new purchase instead of a previous order already present in the browser", async () => {
  const previous = await paidOrder();
  const oldCookie = await access(previous);
  const latest = await paidOrder();
  const row = await env.DB.prepare("SELECT access_token FROM orders WHERE id=?").bind(latest).first<{ access_token: string }>();
  const response = await call("/api/tracking/checkout", {}, oldCookie + "; mt_order=" + row!.access_token);
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const follow = await call("/api/tracking", undefined, cookie);
  expect(await follow.json()).toMatchObject({ reference: latest.slice(0, 8).toUpperCase() });
  await env.DB.prepare("UPDATE orders SET created_at=0 WHERE id=?").bind(latest).run();
  expect((await call("/api/tracking/checkout", {}, "mt_order=" + row!.access_token)).status).toBe(401);
});
it("returns identical recovery messages, deduplicates requests, and enforces rate limiting", async () => {
  const id = await paidOrder();
  const body = { email: "parent@example.com", reference: id.slice(0, 8) };
  const known = await call("/api/tracking/email", body);
  const unknown = await call("/api/tracking/email", { ...body, email: "unknown@example.com" });
  expect(await known.json()).toEqual(await unknown.json());
  await call("/api/tracking/email", body);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='access'").first())?.n).toBe(1);
  const blocked = { ...bindings, CHECKOUT_LIMITER: { limit: async () => ({ success: false }) } };
  expect((await call("/api/tracking/email", body, undefined, blocked)).status).toBe(429);
});
it("shows the operator whether Resend sending is configured without exposing the key", async () => {
  const live = { ...bindings, CHECKOUT_MODE: "live", EMAIL_ENABLED: "true", RESEND_API_KEY: "re_fixture_not_a_real_key" };
  const cookie = await admin(live);
  for (const [custom, expected] of [[live, true], [{ ...live, RESEND_API_KEY: "" }, false], [{ ...live, CHECKOUT_MODE: "test" }, false]] as const) {
    const response = await call("/api/admin/orders", undefined, cookie, custom);
    const body = await response.json();
    expect(body).toMatchObject({ emailEnabled: expected });
    expect(JSON.stringify(body)).not.toContain("re_fixture");
  }
});
it("sends through Resend only in live mode and reuses an identical request after a rate limit", async () => {
  const id = await paidOrder("live");
  await paidOrder("test");
  const send = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: "message-fixture" }));
  const live = { ...bindings, CHECKOUT_MODE: "live", EMAIL_ENABLED: "true", RESEND_API_KEY: "re_fixture_not_a_real_key", EMAIL_REPLY_TO: "support@example.com" };
  for (const custom of [
    { ...live, EMAIL_ENABLED: "false" }, { ...live, CHECKOUT_MODE: "demo" }, { ...live, CHECKOUT_MODE: "test" },
    { ...live, RESEND_API_KEY: "" }, { ...live, EMAIL_FROM: "" }, { ...live, TRACKING_LINK_SECRET: "" },
  ]) await sendNotifications(custom);
  expect(send).not.toHaveBeenCalled();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  send.mockResolvedValueOnce(Response.json({ name: "rate_limit_exceeded", message: "temporary" }, { status: 429, headers: { "Retry-After": "900" } }));
  await sendNotifications(live);
  expect(await env.DB.prepare("SELECT status,available_at,error_code FROM notification_outbox WHERE order_id=?").bind(id).first())
    .toMatchObject({ status: "pending", available_at: now + 900000, error_code: "RESEND_RATE_LIMIT_EXCEEDED" });
  await sendNotifications(live);
  expect(send).toHaveBeenCalledTimes(1);
  vi.mocked(Date.now).mockReturnValue(now + 900000);
  await Promise.all([sendNotifications(live), sendNotifications(live)]);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0]).toBe("https://api.resend.com/emails");
  const request = send.mock.calls[1][1]!;
  expect(request.method).toBe("POST");
  expect(request.headers).toMatchObject({ Authorization: "Bearer re_fixture_not_a_real_key", "Idempotency-Key": "notification/" + id + "/confirmation" });
  expect(request.body).toBe(send.mock.calls[0][1]!.body);
  const body = JSON.parse(request.body as string);
  expect(body).toMatchObject({ from: "Les aventures de mon doudou et ma tétine <bonjour@example.com>", to: ["parent@example.com"],
    subject: `Votre commande ${id.slice(0, 8).toUpperCase()} est confirmée`, reply_to: "support@example.com" });
  expect(body.html).toContain("/suivi#acces=");
  expect(body.text).toContain("/suivi#acces=");
  expect(body.html).not.toContain("Camille");
  expect(await env.DB.prepare("SELECT status,provider_id FROM notification_outbox WHERE order_id=?").bind(id).first())
    .toMatchObject({ status: "sent", provider_id: "message-fixture" });
  await sendNotifications(live);
  expect(send).toHaveBeenCalledTimes(2);
});
it.each([
  [401, "invalid_api_key", "failed"], [403, "validation_error", "failed"], [422, "validation_error", "failed"],
  [409, "invalid_idempotent_request", "failed"], [409, "concurrent_idempotent_requests", "pending"],
  [500, "application_error", "pending"], [503, "service_unavailable", "pending"],
])("handles Resend %i %s as %s without logging personal data", async (status, name, expected) => {
  await paidOrder("live");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ name, message: "private parent@example.com" }, { status }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await sendNotifications({ ...bindings, CHECKOUT_MODE: "live", EMAIL_ENABLED: "true", RESEND_API_KEY: "re_fixture_not_a_real_key" });
  expect(await env.DB.prepare("SELECT status,error_code FROM notification_outbox").first())
    .toMatchObject({ status: expected, error_code: "RESEND_" + name.toUpperCase() });
  expect(JSON.stringify(log.mock.calls)).not.toContain("parent@example.com");
});
it("retries network and malformed responses, then stops after the last expired lease", async () => {
  await paidOrder("live");
  const send = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce(Response.json({}));
  const live = { ...bindings, CHECKOUT_MODE: "live", EMAIL_ENABLED: "true", RESEND_API_KEY: "re_fixture_not_a_real_key" };
  await sendNotifications(live);
  expect(await env.DB.prepare("SELECT status,error_code FROM notification_outbox").first()).toMatchObject({ status: "pending", error_code: "SEND_FAILED" });
  await env.DB.prepare("UPDATE notification_outbox SET available_at=0").run();
  await sendNotifications(live);
  expect(await env.DB.prepare("SELECT status,error_code FROM notification_outbox").first()).toMatchObject({ status: "pending", error_code: "RESEND_INVALID_RESPONSE" });
  await env.DB.prepare("UPDATE notification_outbox SET status='sending',attempts=5,available_at=0").run();
  await sendNotifications(live);
  expect(await env.DB.prepare("SELECT status,error_code FROM notification_outbox").first()).toMatchObject({ status: "failed", error_code: "RETRY_EXHAUSTED" });
  expect(send).toHaveBeenCalledTimes(2);
});
it("uses different idempotency keys for confirmations, dispatches and recovery emails", async () => {
  const id = await paidOrder("live");
  const now = Date.now();
  await env.DB.prepare("UPDATE order_cards SET state='sent',sent_date='2026-11-03' WHERE order_id=? AND position=1").bind(id).run();
  for (const kind of ["shipped", "access"]) {
    await env.DB.prepare("INSERT INTO notification_outbox(id,order_id,kind,card_position,available_at,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id + "/" + kind, id, kind, kind === "shipped" ? 1 : null, now, now).run();
  }
  const send = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ id: crypto.randomUUID() }));
  await sendNotifications({ ...bindings, CHECKOUT_MODE: "live", EMAIL_ENABLED: "true", RESEND_API_KEY: "re_fixture_not_a_real_key" });
  expect(send).toHaveBeenCalledTimes(3);
  const keys = send.mock.calls.map(([, init]) => new Headers(init!.headers).get("Idempotency-Key"));
  expect(new Set(keys).size).toBe(3);
  const bodies = send.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
  expect(bodies.map(body => body.subject)).toEqual(expect.arrayContaining([
    `Votre commande ${id.slice(0, 8).toUpperCase()} est confirmée`,
    `Carte 1 expédiée — commande ${id.slice(0, 8).toUpperCase()}`,
    `Votre lien de suivi — commande ${id.slice(0, 8).toUpperCase()}`,
  ]));
  for (const body of bodies) expect(body).not.toHaveProperty("reply_to");
  const message = notificationMessage("access", "<script>", "https://example.com/#x");
  expect(message.html).not.toContain("<script>");
  expect(message.html).toContain("&lt;script&gt;");
  expect(message.text).toContain("https://example.com/#x");
});

it("schedules grouped cards together and dispatches all ready cards once with one notification", async () => {
  const id = await paidOrder();
  await env.DB.prepare("UPDATE orders SET delivery_mode='together' WHERE id=?").bind(id).run();
  const cookie = await admin();
  const path = "/api/admin/orders/" + id;
  const today = parisDate();
  expect((await call(path + "/schedule", { date: today, version: 0 }, cookie)).status).toBe(200);
  const cards = (await env.DB.prepare("SELECT * FROM order_cards WHERE order_id=?").bind(id).all()).results;
  expect(cards.map(card => card.planned_date)).toEqual([today, today, today]);
  await env.DB.prepare("UPDATE order_cards SET state='ready' WHERE order_id=? AND position=1").bind(id).run();
  expect((await call(path + "/cards/1", { state: "sent", version: 1, sentDate: today }, cookie)).status).toBe(409);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM order_cards WHERE state='sent'").first())?.n).toBe(0);
  await env.DB.prepare("UPDATE order_cards SET state='ready' WHERE order_id=?").bind(id).run();
  expect((await call(path + "/cards/1", { state: "sent", version: 0, sentDate: today }, cookie)).status).toBe(409);
  const results = await Promise.all([
    call(path + "/cards/2", { state: "sent", version: 1, sentDate: today }, cookie),
    call(path + "/cards/1", { state: "sent", version: 1, sentDate: today }, cookie),
  ]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  const sent = (await env.DB.prepare("SELECT state,sent_date FROM order_cards WHERE order_id=?").bind(id).all()).results;
  expect(sent).toEqual(Array(3).fill({ state: "sent", sent_date: today }));
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='shipped'").first())?.n).toBe(1);
  const customer = await call("/api/tracking", undefined, await access(id));
  expect(await customer.json()).toMatchObject({ deliveryMode: "together" });
});
it("rolls back grouped dispatches atomically from any card and cancels the shared notification", async () => {
  const id = await paidOrder();
  await env.DB.prepare("UPDATE orders SET delivery_mode='together' WHERE id=?").bind(id).run();
  await env.DB.prepare("UPDATE order_cards SET state='ready' WHERE order_id=?").bind(id).run();
  const cookie = await admin();
  const path = "/api/admin/orders/" + id + "/cards/";
  expect((await call(path + 2, { state: "sent", version: 0, sentDate: parisDate() }, cookie)).status).toBe(200);
  expect((await call(path + 2, { state: "ready", version: 0 }, cookie)).status).toBe(409);
  await env.DB.prepare("UPDATE notification_outbox SET status='sending' WHERE kind='shipped'").run();
  expect((await call(path + 3, { state: "ready", version: 1 }, cookie)).status).toBe(409);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM order_cards WHERE state='sent'").first())?.n).toBe(3);
  await env.DB.prepare("UPDATE notification_outbox SET status='pending' WHERE kind='shipped'").run();
  expect((await call(path + 2, { state: "ready", version: 1 }, cookie)).status).toBe(200);
  const cards = await env.DB.prepare("SELECT state,sent_date,version FROM order_cards WHERE order_id=?").bind(id).all();
  expect(cards.results).toEqual(Array(3).fill({ state: "ready", sent_date: null, version: 2 }));
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='shipped'").first())?.n).toBe(0);
  expect((await call(path + 1, { state: "sent", version: 2, sentDate: parisDate() }, cookie)).status).toBe(200);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE kind='shipped'").first())?.n).toBe(1);
});
it("uses grouped delivery wording in confirmation and shipping emails", async () => {
  const id = await paidOrder("live");
  await env.DB.prepare("UPDATE orders SET delivery_mode='together' WHERE id=?").bind(id).run();
  const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "grouped-message" }));
  await sendNotifications({ ...bindings, CHECKOUT_MODE: "live", EMAIL_ENABLED: "true", RESEND_API_KEY: "re_fixture" });
  const message = JSON.parse(send.mock.calls[0][1]!.body as string);
  expect(message.text).toContain("un seul envoi");
  expect(message.text).not.toContain("jours d’intervalle");
  const shipped = notificationMessage("shipped", "EXAMPLE", origin + "/suivi", 1, parisDate(), "together");
  expect(shipped.subject).toContain("Vos cartes ont été expédiées");
  expect(shipped.text).toContain("toutes vos cartes dans un seul envoi");
});
