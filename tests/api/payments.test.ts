/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import baseSchema from "../../migrations/0001_orders.sql?raw";
import companionSchema from "../../migrations/0002_companions.sql?raw";
import postcardSchema from "../../migrations/0003_postcards.sql?raw";
const schema = baseSchema + "\n" + companionSchema + "\n" + postcardSchema;
import { api } from "../../src/lib/api";
import { cleanupOrders, stripeClient } from "../../src/lib/payments";
import { limitedBody, validatePhoto } from "../../src/lib/validation";

const origin = "https://les-vacances-de-ma-tetine.com";
const bindings: AppEnv = {
  ...env,
  PHOTOS: (env as unknown as { PHOTOS: R2Bucket }).PHOTOS,
  CHECKOUT_LIMITER: { limit: async () => ({ success: true }) },
};
beforeEach(async () => {
  await env.DB.batch(
    schema
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => env.DB.prepare(s)),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
function payload() {
  const form = new FormData();
  for (const [k, v] of Object.entries({
    attemptId: crypto.randomUUID(),
    adventure: "tropiques",
    quantity: "1",
    companion: "tetine",
    companionName: "",
    childName: "Camille",
    firstName: "Alex",
    lastName: "Exemple",
    email: "parent@example.com",
    address: "1 rue du Test",
    addressExtra: "",
    postalCode: "75001",
    city: "Paris",
    country: "FR",
    notes: "",
    photoConsent: "on",
    termsConsent: "on",
  }))
    form.set(k, v);
  form.set(
    "pacifierPhoto",
    new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3])],
      "photo.jpg",
      { type: "image/jpeg" },
    ),
  );
  return form;
}
function request(form: FormData, requestOrigin = origin) {
  return new Request(`${origin}/api/checkout`, {
    method: "POST",
    headers: { Origin: requestOrigin },
    body: form,
  });
}
function mockStripe(sessionId = "cs_test_fixture", unitAmount = 700, quantity = 1) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const target =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      expect(target).toBe("https://api.stripe.com/v1/checkout/sessions");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("line_items[0][price_data][unit_amount]")).toBe(String(unitAmount));
      expect(body.get("line_items[0][quantity]")).toBe(String(quantity));
      expect(body.get("allowed_payment_method_types[0]")).toBe("card");
      expect(body.get("success_url")).toBe(`${origin}/confirmation`);
      return Response.json({
        id: sessionId,
        url: `https://checkout.stripe.com/c/pay/${sessionId}`,
      });
    });
}
async function webhook(
  id: string,
  sessionId = "cs_test_fixture",
  opts: {
    type?: string;
    amount?: number;
    paid?: string;
    live?: boolean;
    timestamp?: number;
  } = {},
) {
  const event = {
    id: "evt_fixture",
    object: "event",
    type: opts.type || "checkout.session.completed",
    livemode: opts.live ?? false,
    data: {
      object: {
        id: sessionId,
        metadata: { order_id: id },
        payment_status: opts.paid || "paid",
        amount_total: opts.amount ?? 700,
        currency: "eur",
      },
    },
  };
  const body = JSON.stringify(event);
  const signature = await stripeClient(
    bindings,
  ).webhooks.generateTestHeaderStringAsync({
    payload: body,
    secret: bindings.STRIPE_WEBHOOK_SECRET!,
    timestamp: opts.timestamp,
    cryptoProvider: (
      await import("stripe")
    ).default.createSubtleCryptoProvider(),
  });
  return api(
    new Request(`${origin}/api/stripe/webhook`, {
      method: "POST",
      headers: { "Stripe-Signature": signature },
      body,
    }),
    bindings,
  );
}
it("stores private photos and one pending order, fixes the amount and reuses retried checkout", async () => {
  const fetch = mockStripe();
  const form = payload();
  form.set("amount", "1");
  const id = String(form.get("attemptId"));
  const response = await api(request(form), bindings);
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain(
    "HttpOnly; SameSite=Lax",
  );
  expect(response.headers.get("set-cookie")).toContain("Secure");
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?")
    .bind(id)
    .first();
  expect(order?.status).toBe("pending");
  expect(order?.amount_cents).toBe(700);
  expect(order?.child_key).toBe(null);
  expect(await bindings.PHOTOS!.head(`orders/${id}/child`)).toBe(null);
  expect(order?.companion_type).toBe("tetine");
  expect(await bindings.PHOTOS!.head(`orders/${id}/pacifier`)).not.toBe(null);
  expect((await api(request(form), bindings)).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const status = await api(
    new Request(`${origin}/api/order-status`, { headers: { cookie } }),
    bindings,
  );
  expect(await status.json()).toEqual({
    status: "pending",
    reference: id.slice(0, 8).toUpperCase(),
  });
});
it("confirms only a verified payment and handles retries and expired events without downgrading", async () => {
  mockStripe();
  const form = payload();
  const id = String(form.get("attemptId"));
  await api(request(form), bindings);
  expect((await webhook(id)).status).toBe(200);
  expect((await webhook(id)).status).toBe(200);
  expect(
    (await webhook(id, "cs_test_fixture", { type: "checkout.session.expired" }))
      .status,
  ).toBe(200);
  expect(
    (
      await env.DB.prepare("SELECT status FROM orders WHERE id=?")
        .bind(id)
        .first()
    )?.status,
  ).toBe("paid");
  expect(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM stripe_events",
      ).first()
    )?.count,
  ).toBe(1);
});
it("rejects tampered signatures, wrong sessions, amounts, modes and stale events", async () => {
  mockStripe();
  const form = payload();
  const id = String(form.get("attemptId"));
  await api(request(form), bindings);
  expect(
    (
      await api(
        new Request(`${origin}/api/stripe/webhook`, {
          method: "POST",
          headers: { "Stripe-Signature": "t=0,v1=invalid" },
          body: "{}",
        }),
        bindings,
      )
    ).status,
  ).toBe(400);
  expect((await webhook(id, "wrong")).status).toBe(409);
  expect((await webhook(id, "cs_test_fixture", { amount: 1 })).status).toBe(
    409,
  );
  expect((await webhook(id, "cs_test_fixture", { live: true })).status).toBe(
    409,
  );
  expect((await webhook(id, "cs_test_fixture", { timestamp: 1 })).status).toBe(
    400,
  );
  expect(
    (await webhook(id, "cs_test_fixture", { paid: "unpaid" })).status,
  ).toBe(200);
  expect(
    (
      await env.DB.prepare("SELECT status FROM orders WHERE id=?")
        .bind(id)
        .first()
    )?.status,
  ).toBe("pending");
});
it("rejects cross-origin requests, demo payments, live credentials in test mode and missing consent", async () => {
  expect(
    (await api(request(payload(), "https://evil.example"), bindings)).status,
  ).toBe(403);
  expect(
    (await api(request(payload()), { ...bindings, CHECKOUT_MODE: "demo" }))
      .status,
  ).toBe(503);
  expect(
    (await api(request(payload()), { ...bindings, PHOTOS: undefined })).status,
  ).toBe(503);
  expect(
    (
      await api(request(payload()), {
        ...bindings,
        STRIPE_SECRET_KEY: "sk_live_not_real",
      })
    ).status,
  ).toBe(503);
  const form = payload();
  form.delete("photoConsent");
  expect((await api(request(form), bindings)).status).toBe(400);
  expect(
    (await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first())
      ?.count,
  ).toBe(0);
});
it("rejects unknown adventures, invalid postal codes, spoofed and oversized files", async () => {
  let form = payload();
  form.set("adventure", "cheap");
  expect((await api(request(form), bindings)).status).toBe(400);
  form = payload();
  form.set("postalCode", "97100");
  expect((await api(request(form), bindings)).status).toBe(400);
  form = payload();
  form.set(
    "pacifierPhoto",
    new File(["<svg/>"], "bad.jpg", { type: "image/jpeg" }),
  );
  expect((await api(request(form), bindings)).status).toBe(400);
  await expect(
    validatePhoto(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpg", {
        type: "image/jpeg",
      }),
      true,
    ),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    limitedBody(new Request(origin, { method: "POST", body: "too long" }), 3),
  ).rejects.toMatchObject({ status: 413 });
});
it("does not allow a changed payload to reuse an existing checkout", async () => {
  mockStripe();
  const form = payload();
  await api(request(form), bindings);
  form.set("childName", "Different");
  expect((await api(request(form), bindings)).status).toBe(409);
});
it("retains a recoverable intent on Stripe failure and retries with the same order", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(
      { error: { message: "Unavailable", type: "invalid_request_error" } },
      { status: 400 },
    ),
  );
  const form = payload();
  expect((await api(request(form), bindings)).status).toBe(503);
  vi.restoreAllMocks();
  mockStripe();
  expect((await api(request(form), bindings)).status).toBe(200);
  expect(
    (await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first())
      ?.count,
  ).toBe(1);
});
it("exposes no order data without its private cookie", async () => {
  expect(
    (await api(new Request(`${origin}/api/order-status`), bindings)).status,
  ).toBe(404);
  expect(
    (
      await api(
        new Request(`${origin}/api/order-status`, {
          headers: {
            Cookie: `mt_order=${crypto.randomUUID() + crypto.randomUUID()}`,
          },
        }),
        bindings,
      )
    ).status,
  ).toBe(404);
});
it("removes abandoned data after 7 days and paid photos after 90 days", async () => {
  mockStripe();
  const form = payload();
  const id = String(form.get("attemptId"));
  await api(request(form), bindings);
  await env.DB.prepare("UPDATE orders SET created_at=? WHERE id=?")
    .bind(Date.now() - 8 * 86400000, id)
    .run();
  await cleanupOrders(bindings);
  expect(
    await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first(),
  ).toBe(null);
  expect(await bindings.PHOTOS!.head(`orders/${id}/pacifier`)).toBe(null);
  const next = payload();
  const paidId = String(next.get("attemptId"));
  await api(request(next), bindings);
  await webhook(paidId);
  const legacyChildKey = `orders/${paidId}/child`;
  await bindings.PHOTOS!.put(legacyChildKey, "legacy portrait");
  await env.DB.prepare("UPDATE orders SET created_at=?,child_key=? WHERE id=?")
    .bind(Date.now() - 91 * 86400000, legacyChildKey, paidId)
    .run();
  await cleanupOrders(bindings);
  const paid = await env.DB.prepare("SELECT * FROM orders WHERE id=?")
    .bind(paidId)
    .first();
  expect(paid?.status).toBe("paid");
  expect(paid?.pacifier_key).toBe(null);
  expect(paid?.child_key).toBe(null);
  expect(await bindings.PHOTOS!.head(legacyChildKey)).toBe(null);
  expect(paid?.photos_deleted_at).toBeGreaterThan(0);
});

it("stores a named doudou and sends only the generic companion title to Stripe", async () => {
  const fetch = mockStripe();
  const form = payload();
  form.set("companion", "doudou");
  form.set("companionName", "Lapinou");
  expect((await api(request(form), bindings)).status).toBe(200);
  const order = await env.DB.prepare(
    "SELECT companion_type,companion_name FROM orders WHERE id=?",
  )
    .bind(form.get("attemptId"))
    .first();
  expect(order).toEqual({
    companion_type: "doudou",
    companion_name: "Lapinou",
  });
  const sent = new URLSearchParams(String(fetch.mock.calls[0][1]?.body));
  expect(sent.get("line_items[0][price_data][product_data][name]")).toBe(
    "Carte postale personnalisée — Doudou",
  );
  expect(sent.get("cancel_url")).toContain("compagnon=doudou");
  expect(String(fetch.mock.calls[0][1]?.body)).not.toContain("Lapinou");
});
it("rejects an unknown companion and a missing companion photo before uploading or contacting Stripe", async () => {
  const fetch = mockStripe();
  const form = payload();
  form.set("companion", "unknown");
  expect((await api(request(form), bindings)).status).toBe(400);
  form.set("companion", "doudou");
  form.delete("pacifierPhoto");
  const response = await api(request(form), bindings);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Ajoutez une photo de son compagnon.",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(
    (await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first())
      ?.count,
  ).toBe(0);
});
it("does not reuse a checkout after switching companions", async () => {
  mockStripe();
  const form = payload();
  await api(request(form), bindings);
  form.set("companion", "doudou");
  expect((await api(request(form), bindings)).status).toBe(409);
});

it("rejects child photos without storing a file, creating an order or contacting Stripe", async () => {
  const fetch = mockStripe();
  const form = payload();
  form.set("childPhoto", form.get("pacifierPhoto")!);
  const response = await api(request(form), bindings);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Seule la photo de son compagnon est acceptée." });
  expect((await bindings.PHOTOS!.list()).objects).toEqual([]);
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first())?.count).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});


it.each([[1, 700, 700], [2, 600, 1200], [3, 550, 1650], [4, 525, 2100], [5, 500, 2500]])("prices %i postcards on the server and persists the weekly itinerary", async (quantity, unit, total) => {
  const fetch = mockStripe("cs_test_pack", unit, quantity);
  const form = payload();
  const choices = ["safari", "bateau", "pelleteuse", "circuit", "noel"].slice(0, quantity);
  form.set("quantity", String(quantity));
  form.set("amount", "1");
  form.set("unitPriceCents", "1");
  form.delete("adventure");
  choices.forEach((choice) => form.append("adventure", choice));
  expect((await api(request(form), bindings)).status).toBe(200);
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(form.get("attemptId")).first();
  expect(order).toMatchObject({ product_type: "postcards", card_quantity: quantity, unit_price_cents: unit, amount_cents: total, card_adventures: JSON.stringify(choices), send_interval_days: 7, child_key: null });
  const sent = new URLSearchParams(String(fetch.mock.calls[0][1]?.body));
  expect(sent.get("mode")).toBe("payment");
  expect(sent.get("cancel_url")).toContain(`cartes=${quantity}`);
  expect(String(fetch.mock.calls[0][1]?.body)).not.toContain("Camille");
  expect((await webhook(String(form.get("attemptId")), "cs_test_pack", { amount: total })).status).toBe(200);
});

it.each(["0", "6", "-1", "1.5", "05", "1e0", ""])('rejects invalid postcard quantity "%s" before any upload', async (quantity) => {
  const fetch = mockStripe();
  const form = payload();
  form.set("quantity", quantity);
  expect((await api(request(form), bindings)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first())?.count).toBe(0);
});

it("requires exactly one supported adventure per card and protects itinerary retries", async () => {
  const fetch = mockStripe();
  const form = payload();
  form.set("quantity", "2");
  expect((await api(request(form), bindings)).status).toBe(400);
  form.append("adventure", "invalid");
  expect((await api(request(form), bindings)).status).toBe(400);
  form.set("quantity", "1");
  form.set("adventure", "tropiques");
  expect((await api(request(form), bindings)).status).toBe(200);
  form.set("adventure", "bateau");
  expect((await api(request(form), bindings)).status).toBe(409);
  form.set("quantity", "2");
  form.append("adventure", "avion");
  expect((await api(request(form), bindings)).status).toBe(409);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([2, 5])("rejects a duplicate adventure in a %i-card order before storage or payment", async (quantity) => {
  const fetch = mockStripe();
  const form = payload();
  form.set("quantity", String(quantity));
  const choices = ["safari", "bateau", "circuit", "espace", "noel"].slice(0, quantity);
  choices[quantity - 1] = choices[0];
  form.delete("adventure");
  choices.forEach(choice => form.append("adventure", choice));
  const response = await api(request(form), bindings);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Choisissez une aventure différente pour chaque carte." });
  expect((await bindings.PHOTOS!.list()).objects).toEqual([]);
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first())?.count).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("preserves historical book orders and webhook references during the postcard migration", async () => {
  await reset();
  const apply = async (sql: string) => env.DB.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => env.DB.prepare(s)));
  await apply(baseSchema + "\n" + companionSchema);
  await env.DB.prepare(`INSERT INTO orders (id,request_hash,access_token,book,child_name,first_name,last_name,email,address,postal_code,city,amount_cents,payment_mode,consent_version,created_at,status,stripe_session_id,pacifier_key,companion_type,companion_name) VALUES ('old','hash','token','ski','Camille','Alex','Exemple','parent@example.com','1 rue du Test','75001','Paris',2990,'test','2026-10-21',1,'paid','cs_old','orders/old/pacifier','doudou','Lapinou')`).run();
  await env.DB.prepare("INSERT INTO stripe_events VALUES ('evt_old','old','checkout.session.completed',1)").run();
  await apply(postcardSchema);
  expect(await env.DB.prepare("SELECT * FROM orders WHERE id='old'").first()).toMatchObject({ id: "old", book: "ski", amount_cents: 2990, product_type: "book", status: "paid", stripe_session_id: "cs_old", access_token: "token", pacifier_key: "orders/old/pacifier", companion_name: "Lapinou" });
  expect((await env.DB.prepare("SELECT order_id FROM stripe_events WHERE id='evt_old'").first())?.order_id).toBe("old");
});
