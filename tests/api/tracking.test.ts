/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import base from "../../migrations/0001_orders.sql?raw";
import companions from "../../migrations/0002_companions.sql?raw";
import postcards from "../../migrations/0003_postcards.sql?raw";
import tracking from "../../migrations/0004_tracking.sql?raw";
import { api } from "../../src/lib/api";
import { paidOrderStatements } from "../../src/lib/tracking";
import { trackingLink } from "../../src/lib/tracking-auth";
import { notificationMessage, sendNotifications } from "../../src/lib/notifications";
import { addDays, parisDate } from "../../src/lib/tracking-model";

const origin = "https://les-vacances-de-ma-tetine.com";
const adminPassword = "fixture-admin-password-for-local-tests";
const bindings: AppEnv = { ...env, CHECKOUT_MODE: "test", EMAIL_ENABLED: "false", EMAIL_FROM: "bonjour@example.com", EMAIL_REPLY_TO: "",
  ADMIN_PASSWORD: adminPassword, TRACKING_LINK_SECRET: "fixture-tracking-secret-for-local-tests-only",
  CHECKOUT_LIMITER: { limit: async () => ({ success: true }) } };
beforeEach(async () => {
  await env.DB.batch([base, companions, postcards, tracking].join("\n").split(";").map(s => s.trim()).filter(Boolean).map(s => env.DB.prepare(s)));
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
it("sends nothing in demo/test/disabled mode, retries transient errors and avoids concurrent duplicate sends", async () => {
  const id = await paidOrder("live");
  const send = vi.fn().mockResolvedValue({ messageId: "message-fixture" });
  const email = { send };
  const live = { ...bindings, CHECKOUT_MODE: "live", EMAIL_ENABLED: "true", EMAIL: email };
  await sendNotifications({ ...live, EMAIL_ENABLED: "false" });
  await sendNotifications({ ...live, CHECKOUT_MODE: "demo" });
  await sendNotifications({ ...live, CHECKOUT_MODE: "test" });
  expect(send).not.toHaveBeenCalled();
  send.mockRejectedValueOnce(Object.assign(new Error("temporary"), { code: "E_RATE_LIMIT_EXCEEDED" }));
  await sendNotifications(live);
  expect((await env.DB.prepare("SELECT status FROM notification_outbox WHERE order_id=?").bind(id).first())?.status).toBe("pending");
  await env.DB.prepare("UPDATE notification_outbox SET available_at=0").run();
  await Promise.all([sendNotifications(live), sendNotifications(live)]);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0]).toMatchObject({ to: "parent@example.com", subject: "Le voyage de son compagnon commence" });
  expect(send.mock.calls[1][0].html).toContain("/suivi#acces=");
  expect((await env.DB.prepare("SELECT status FROM notification_outbox").first())?.status).toBe("sent");
  await sendNotifications(live);
  expect(send).toHaveBeenCalledTimes(2);
});
it("marks permanent email failures and exhausted leases for operator attention", async () => {
  await paidOrder("live");
  const send = vi.fn().mockRejectedValue(Object.assign(new Error("suppressed"), { code: "E_RECIPIENT_SUPPRESSED" }));
  await sendNotifications({ ...bindings, CHECKOUT_MODE: "live", EMAIL_ENABLED: "true", EMAIL: { send } });
  expect((await env.DB.prepare("SELECT status,error_code FROM notification_outbox").first())).toMatchObject({ status: "failed", error_code: "E_RECIPIENT_SUPPRESSED" });
  await env.DB.prepare("UPDATE notification_outbox SET status='sending',attempts=5,available_at=0").run();
  await sendNotifications({ ...bindings, CHECKOUT_MODE: "live", EMAIL_ENABLED: "true", EMAIL: { send } });
  expect((await env.DB.prepare("SELECT status,error_code FROM notification_outbox").first())).toMatchObject({ status: "failed", error_code: "RETRY_EXHAUSTED" });
  expect(send).toHaveBeenCalledTimes(1);
  const message = notificationMessage("access", "<script>", "https://example.com/#x");
  expect(message.html).not.toContain("<script>");
  expect(message.html).toContain("&lt;script&gt;");
  expect(message.text).toContain("https://example.com/#x");
});
