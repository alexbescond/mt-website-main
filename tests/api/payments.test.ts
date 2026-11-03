/// <reference types="@cloudflare/vitest-plugin/types" />
import deliverySchema from "../../migrations/0005_delivery_mode.sql?raw";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import baseSchema from "../../migrations/0001_orders.sql?raw";
import companionSchema from "../../migrations/0002_companions.sql?raw";
import postcardSchema from "../../migrations/0003_postcards.sql?raw";
import trackingSchema from "../../migrations/0004_tracking.sql?raw";
import stripeDeliverySchema from "../../migrations/0006_stripe_delivery.sql?raw";
import couponSchema from "../../migrations/0007_coupons.sql?raw";
const schema = baseSchema + "\n" + companionSchema + "\n" + postcardSchema + "\n" + trackingSchema + "\n" + deliverySchema + "\n" + stripeDeliverySchema + "\n" + couponSchema;
import { api } from "../../src/lib/api";
import { checkoutAvailable, cleanupOrders, stripeClient } from "../../src/lib/payments";
import { limitedBody, validatePhoto, sha256 } from "../../src/lib/validation";

const origin = "https://les-aventures-de-doudou-tetine.com";
const bindings: AppEnv = {
  ...env,
  PHOTOS: (env as unknown as { PHOTOS: R2Bucket }).PHOTOS,
  CHECKOUT_LIMITER: { limit: async () => ({ success: true }) },
};
const liveBindings: AppEnv = {
  ...bindings,
  CHECKOUT_MODE: "live",
  // Seller information is explicitly being completed separately from payment setup.
  LEGAL_APPROVED: "false",
  STRIPE_SECRET_KEY: "sk_live_fixture_not_a_real_key",
  EMAIL_ENABLED: "true",
  EMAIL_FROM: "orders@example.com",
  RESEND_API_KEY: "re_fixture_not_a_real_key",
  ADMIN_PASSWORD: "fixture_admin_password_long_enough",
  TRACKING_LINK_SECRET: "fixture_tracking_secret_long_enough",
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
    notes: "",
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
      expect(body.get("shipping_address_collection[allowed_countries][0]")).toBe("FR");
      if (unitAmount === 0) expect(body.get("customer_email")).toBe("free@example.com");
      else if ([630, 1282].includes(unitAmount)) expect(body.get("customer_email")).toMatch(/@example\.com$/);
      else expect(body.has("customer_email")).toBe(false);
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
    shipping?: { name: string; address: { line1?: string; line2?: string; postal_code?: string; city?: string; country?: string } } | null;
    email?: string | null;
  } = {},
  webhookBindings: AppEnv = bindings,
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
        collected_information: {
          shipping_details: opts.shipping === undefined ? {
            name: "Alex Marie Exemple",
            address: { line1: "10 rue du Test", line2: "Bâtiment B", postal_code: "75001", city: "Paris", country: "FR" },
          } : opts.shipping,
        },
        customer_details: {
          email: opts.email === undefined ? "parent@example.com" : opts.email,
          // Deliberately different: the billing address must not become the delivery address.
          address: { line1: "99 rue de Facturation", postal_code: "69001", city: "Lyon", country: "FR" },
        },
      },
    },
  };
  const body = JSON.stringify(event);
  const signature = await stripeClient(
    webhookBindings,
  ).webhooks.generateTestHeaderStringAsync({
    payload: body,
    secret: webhookBindings.STRIPE_WEBHOOK_SECRET!,
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
    webhookBindings,
  );
}
it.each(["sk_live_fixture", "rk_live_fixture"])("creates a live checkout with %s and fulfills only its signed live payment", async (key) => {
  const paymentBindings = { ...liveBindings, STRIPE_SECRET_KEY: key };
  const stripe = mockStripe("cs_live_fixture");
  const form = payload();
  const id = String(form.get("attemptId"));
  expect(checkoutAvailable(paymentBindings, new URL(origin))).toBe(true);
  expect((await api(request(form), paymentBindings)).status).toBe(200);
  expect(stripe).toHaveBeenCalledOnce();
  expect(await env.DB.prepare("SELECT status,payment_mode FROM orders WHERE id=?").bind(id).first())
    .toEqual({ status: "pending", payment_mode: "live" });
  expect((await webhook(id, "cs_live_fixture", {}, paymentBindings)).status).toBe(409);
  expect((await webhook(id, "cs_live_fixture", { live: true }, paymentBindings)).status).toBe(200);
  expect((await webhook(id, "cs_live_fixture", { live: true }, paymentBindings)).status).toBe(200);
  expect((await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(id).first())?.status).toBe("paid");
  expect((await env.DB.prepare("SELECT count(*) AS n FROM order_cards WHERE order_id=?").bind(id).first())?.n).toBe(1);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox WHERE order_id=?").bind(id).first())?.n).toBe(1);
});

it.each([
  { STRIPE_SECRET_KEY: "sk_test_fixture" },
  { STRIPE_SECRET_KEY: "rk_test_fixture" },
  { STRIPE_SECRET_KEY: "pk_live_fixture" },
  { STRIPE_WEBHOOK_SECRET: undefined },
  { EMAIL_ENABLED: "false" },
  { RESEND_API_KEY: undefined },
  { EMAIL_FROM: "invalid" },
  { ADMIN_PASSWORD: "too-short" },
  { TRACKING_LINK_SECRET: "too-short" },
  { PHOTOS: undefined },
])("refuses live checkout before writing data when launch configuration is incomplete: %j", async (override) => {
  const stripe = mockStripe();
  const incomplete = { ...liveBindings, ...override };
  expect(await (await api(new Request(`${origin}/api/config`), incomplete)).json())
    .toEqual({ mode: "live", available: false });
  expect((await api(request(payload()), incomplete)).status).toBe(503);
  expect(stripe).not.toHaveBeenCalled();
  expect((await env.DB.prepare("SELECT count(*) AS n FROM orders").first())?.n).toBe(0);
  expect((await bindings.PHOTOS!.list()).objects).toEqual([]);
});

it("allows local sandbox checkout but never real payments over localhost, HTTP or a preview domain", () => {
  expect(checkoutAvailable(bindings, new URL("http://localhost:8787"))).toBe(true);
  expect(checkoutAvailable({ ...bindings, STRIPE_SECRET_KEY: "rk_test_fixture" }, new URL("http://localhost:8787"))).toBe(true);
  expect(checkoutAvailable({ ...bindings, STRIPE_SECRET_KEY: "rk_live_fixture" }, new URL("http://localhost:8787"))).toBe(false);
  for (const url of ["http://localhost:8787", "https://127.0.0.1", "https://preview.example.com", origin.replace("https:", "http:")]) {
    expect(checkoutAvailable(liveBindings, new URL(url))).toBe(false);
  }
  expect(checkoutAvailable({ ...liveBindings, SITE_ORIGIN: "http://example.com" }, new URL("http://example.com"))).toBe(false);
});

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
  expect(order?.delivery_status).toBe("pending");
  expect(order?.address).toBe("");
  expect(order?.email).toBe("");
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
    free: false,
    deliveryStatus: "pending",
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
it("saves the Stripe recipient, delivery address and email atomically before preparation", async () => {
  mockStripe();
  const form = payload();
  const id = String(form.get("attemptId"));
  // A stale or tampered browser form is never the authority for delivery details.
  form.set("email", "tampered@example.com");
  form.set("address", "Tampered address");
  await api(request(form), bindings);
  expect((await webhook(id)).status).toBe(200);
  const saved = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
  expect(saved).toMatchObject({ status: "paid", delivery_status: "ready", recipient_name: "Alex Marie Exemple",
    first_name: "", last_name: "", email: "parent@example.com", address: "10 rue du Test", address_extra: "Bâtiment B",
    postal_code: "75001", city: "Paris", country: "FR" });
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM order_cards WHERE order_id=?").bind(id).first())?.n).toBe(1);
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE order_id=?").bind(id).first())?.n).toBe(1);
  // Replayed or out-of-order events cannot overwrite the accepted delivery details.
  expect((await webhook(id, "cs_test_fixture", { shipping: null })).status).toBe(200);
  expect(await env.DB.prepare("SELECT recipient_name,address,delivery_status FROM orders WHERE id=?").bind(id).first())
    .toEqual({ recipient_name: "Alex Marie Exemple", address: "10 rue du Test", delivery_status: "ready" });
});

it.each([
  null,
  { name: "Alex", address: { country: "FR" } },
  { name: "Alex", address: { line1: "1 rue du Test", postal_code: "97400", city: "Saint-Denis", country: "FR" } },
  { name: "Alex", address: { line1: "1 rue du Test", postal_code: "1000", city: "Bruxelles", country: "BE" } },
])("records payment but holds unsupported or missing Stripe delivery details for review: %j", async shipping => {
  mockStripe();
  const form = payload();
  const id = String(form.get("attemptId"));
  await api(request(form), bindings);
  expect((await webhook(id, "cs_test_fixture", { shipping })).status).toBe(200);
  expect(await env.DB.prepare("SELECT status,delivery_status FROM orders WHERE id=?").bind(id).first())
    .toEqual({ status: "paid", delivery_status: "needs_review" });
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM order_cards WHERE order_id=?").bind(id).first())?.n).toBe(1);
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE order_id=?").bind(id).first())?.n).toBe(0);
});

it("holds a paid order without a usable email and preserves legacy checkout addresses", async () => {
  mockStripe();
  const form = payload();
  const id = String(form.get("attemptId"));
  await api(request(form), bindings);
  expect((await webhook(id, "cs_test_fixture", { email: null })).status).toBe(200);
  expect((await env.DB.prepare("SELECT delivery_status FROM orders WHERE id=?").bind(id).first())?.delivery_status).toBe("needs_review");
  // An older pending checkout already has locally collected, validated coordinates.
  await env.DB.prepare("UPDATE orders SET status='pending',delivery_status='ready',first_name='Alex',last_name='Exemple',address='Ancienne adresse',email='legacy@example.com' WHERE id=?").bind(id).run();
  expect((await webhook(id, "cs_test_fixture", { shipping: null })).status).toBe(200);
  expect(await env.DB.prepare("SELECT status,first_name,last_name,address,email,delivery_status FROM orders WHERE id=?").bind(id).first())
    .toEqual({ status: "paid", first_name: "Alex", last_name: "Exemple", address: "Ancienne adresse", email: "legacy@example.com", delivery_status: "ready" });
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
it("rejects cross-origin requests, demo payments, live credentials in test mode and missing terms acceptance", async () => {
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
  form.delete("termsConsent");
  expect((await api(request(form), bindings)).status).toBe(400);
  expect(
    (await env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first())
      ?.count,
  ).toBe(0);
});
it("rejects unknown adventures, spoofed and oversized files", async () => {
  let form = payload();
  form.set("adventure", "cheap");
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
  await apply(deliverySchema);
  await apply(stripeDeliverySchema);
  expect(await env.DB.prepare("SELECT * FROM orders WHERE id='old'").first()).toMatchObject({ id: "old", book: "ski", amount_cents: 2990, product_type: "book", status: "paid", stripe_session_id: "cs_old", access_token: "token", pacifier_key: "orders/old/pacifier", companion_name: "Lapinou", first_name: "Alex", last_name: "Exemple", address: "1 rue du Test", recipient_name: "", delivery_status: "ready" });
  expect((await env.DB.prepare("SELECT order_id FROM stripe_events WHERE id='evt_old'").first())?.order_id).toBe("old");
});

it.each([[2, 525, 1050], [3, 475, 1425], [4, 450, 1800], [5, 425, 2125]])("applies the grouped delivery discount server-side for %i cards", async (quantity, unit, total) => {
  const fetch = mockStripe("cs_test_together", unit, quantity);
  const form = payload();
  form.set("quantity", String(quantity));
  form.set("deliveryMode", "together");
  form.set("amountCents", "1");
  form.delete("adventure");
  for (const choice of ["safari", "bateau", "pelleteuse", "circuit", "noel"].slice(0, quantity)) form.append("adventure", choice);
  expect((await api(request(form), bindings)).status).toBe(200);
  expect(await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(form.get("attemptId")).first())
    .toMatchObject({ delivery_mode: "together", unit_price_cents: unit, amount_cents: total });
  const sent = new URLSearchParams(String(fetch.mock.calls[0][1]?.body));
  expect(sent.get("line_items[0][price_data][product_data][description]")).toContain("un seul envoi");
  expect(sent.get("cancel_url")).toContain("envoi=together");
  expect((await webhook(String(form.get("attemptId")), "cs_test_together", { amount: total })).status).toBe(200);
  expect((await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(form.get("attemptId")).first())?.status).toBe("paid");
});
it("does not discount a single card, even when grouped delivery is submitted", async () => {
  mockStripe();
  const form = payload(); form.set("deliveryMode", "together");
  expect((await api(request(form), bindings)).status).toBe(200);
  expect(await env.DB.prepare("SELECT delivery_mode,amount_cents FROM orders").first()).toEqual({ delivery_mode: "weekly", amount_cents: 700 });
});
it("rejects an invalid delivery mode before creating an order or payment", async () => {
  const fetch = mockStripe();
  const form = payload(); form.set("deliveryMode", "free");
  expect((await api(request(form), bindings)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
  expect((await env.DB.prepare("SELECT count(*) AS n FROM orders").first())?.n).toBe(0);
});
it("requires a new checkout attempt when the delivery mode changes", async () => {
  mockStripe("cs_weekly", 600, 2);
  const form = payload(); form.set("quantity", "2"); form.append("adventure", "ski");
  expect((await api(request(form), bindings)).status).toBe(200);
  form.set("deliveryMode", "together");
  expect((await api(request(form), bindings)).status).toBe(409);
});

function preview(code = "WELCOME10", email = "parent@example.com", quantity = 1, deliveryMode = "weekly", custom = bindings) {
  return api(new Request(`${origin}/api/coupon`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code, email, quantity, deliveryMode }),
  }), custom);
}
async function privateOffer() {
  // Exercise the seeded private offer using test-only credentials.
  await env.DB.prepare("UPDATE coupons SET code_hash=?,allowed_email_hash=? WHERE id='personal-free'")
    .bind(await sha256("PRIVATE-FREE-TEST"), await sha256("free@example.com")).run();
}
it("previews a normalized code without reserving it and rejects invalid/private inputs generically", async () => {
  await privateOffer();
  expect(await (await preview(" welcome10 ")).json()).toMatchObject({ code: "WELCOME10", percentOff: 10, discountCents: 70, totalCents: 630 });
  expect((await env.DB.prepare("SELECT count(*) AS n FROM orders").first())?.n).toBe(0);
  const missing = await preview("DOES-NOT-EXIST");
  const restricted = await preview("PRIVATE-FREE-TEST");
  expect(missing.status).toBe(400);
  expect(restricted.status).toBe(400);
  expect(await restricted.json()).toEqual(await missing.json());
  expect((await preview("WELCOME10", "invalid")).status).toBe(400);
  expect((await preview("WELCOME10", "parent@example.com", 6)).status).toBe(400);
  expect((await preview("WELCOME10", "parent@example.com", 1, "invalid")).status).toBe(400);
  expect((await preview("WELCOME10", "parent@example.com", 1, "weekly", { ...bindings, CHECKOUT_MODE: "demo" })).status).toBe(503);
  expect((await preview("WELCOME10", "parent@example.com", 1, "weekly", { ...bindings, CHECKOUT_LIMITER: { limit: async () => ({ success: false }) } })).status).toBe(429);
  expect((await api(new Request(`${origin}/api/coupon`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" }), bindings)).status).toBe(403);
});
it("stores the coupon price, ignores client amounts and confirms only the discounted payment", async () => {
  const fetch = mockStripe("cs_discount", 630);
  const form = payload(); form.set("couponEmail", "parent@example.com");
  form.set("couponCode", " welcome10 ");
  form.set("amountCents", "0");
  form.set("couponDiscountCents", "700");
  form.set("couponExpectedTotal", "630");
  const id = String(form.get("attemptId"));
  expect((await api(request(form), bindings)).status).toBe(200);
  expect(await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first()).toMatchObject({ subtotal_cents: 700, amount_cents: 630, coupon_id: "welcome10", coupon_percent_off: 10, coupon_discount_cents: 70, coupon_first_order: 1 });
  expect((await api(request(form), bindings)).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await webhook(id, "cs_discount", { amount: 700 })).status).toBe(409);
  expect((await webhook(id, "cs_discount", { amount: 630 })).status).toBe(200);
  expect((await preview()).status).toBe(400);
  form.set("attemptId", crypto.randomUUID());
  expect((await api(request(form), bindings)).status).toBe(400);
});
it("rounds the discount once on the subtotal after grouped delivery", async () => {
  mockStripe("cs_rounding", 1282);
  const form = payload(); form.set("couponEmail", "parent@example.com");
  form.set("quantity", "3"); form.set("deliveryMode", "together");
  form.append("adventure", "ski"); form.append("adventure", "espace");
  form.set("couponCode", "WELCOME10");
  expect(await (await preview("WELCOME10", "parent@example.com", 3, "together")).json()).toMatchObject({ discountCents: 143, totalCents: 1282 });
  expect((await api(request(form), bindings)).status).toBe(200);
  expect(await env.DB.prepare("SELECT subtotal_cents,amount_cents,coupon_discount_cents FROM orders").first()).toEqual({ subtotal_cents: 1425, amount_cents: 1282, coupon_discount_cents: 143 });
});
it("rejects a changed preview price before creating an order or contacting Stripe", async () => {
  const fetch = mockStripe();
  const form = payload(); form.set("couponEmail", "parent@example.com"); form.set("couponCode", "WELCOME10"); form.set("couponExpectedTotal", "0");
  expect((await api(request(form), bindings)).status).toBe(409);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM orders").first())?.n).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
it("restricts the free offer to its email and fulfils zero-cost checkouts only on verified completion", async () => {
  await privateOffer();
  const fetch = mockStripe("cs_free", 0);
  const form = payload(); form.set("couponEmail", "parent@example.com"); form.set("couponCode", "private-free-test");
  const id = String(form.get("attemptId"));
  expect((await api(request(form), bindings)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
  expect((await bindings.PHOTOS!.list()).objects).toHaveLength(0);
  form.set("couponEmail", " Free@Example.com ");
  expect(await (await preview("private-free-test", " Free@Example.com ")).json()).toMatchObject({ percentOff: 100, totalCents: 0 });
  const response = await api(request(form), bindings);
  expect(response.status).toBe(200);
  expect(await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first()).toMatchObject({ email: "", coupon_email: "free@example.com", status: "pending", amount_cents: 0, subtotal_cents: 700, coupon_discount_cents: 700 });
  expect((await env.DB.prepare("SELECT count(*) AS n FROM order_cards").first())?.n).toBe(0);
  expect((await webhook(id, "wrong", { paid: "no_payment_required", amount: 0, email: "free@example.com" })).status).toBe(409);
  expect((await webhook(id, "cs_free", { paid: "no_payment_required", amount: 1 })).status).toBe(409);
  expect((await webhook(id, "cs_free", { paid: "unpaid", amount: 0 })).status).toBe(200);
  expect((await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(id).first())?.status).toBe("pending");
  expect((await webhook(id, "cs_free", { paid: "no_payment_required", amount: 0, email: "free@example.com" })).status).toBe(200);
  expect((await webhook(id, "cs_free", { paid: "no_payment_required", amount: 0, email: "free@example.com" })).status).toBe(200);
  expect((await webhook(id, "cs_free", { type: "checkout.session.expired" })).status).toBe(200);
  expect((await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(id).first())?.status).toBe("paid");
  expect((await env.DB.prepare("SELECT count(*) AS n FROM order_cards").first())?.n).toBe(1);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox").first())?.n).toBe(1);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  expect(await (await api(new Request(`${origin}/api/order-status`, { headers: { cookie } }), bindings)).json()).toMatchObject({ status: "paid", free: true });
  expect((await preview("PRIVATE-FREE-TEST", "free@example.com")).status).toBe(200);
  expect((await preview("PRIVATE-FREE-TEST", "free+alias@example.com")).status).toBe(400);
});
it("does not treat no_payment_required as payment for a nonzero order", async () => {
  mockStripe(); const form = payload(); form.set("couponEmail", "parent@example.com"); await api(request(form), bindings);
  expect((await webhook(String(form.get("attemptId")), "cs_test_fixture", { paid: "no_payment_required", amount: 700 })).status).toBe(200);
  expect((await env.DB.prepare("SELECT status FROM orders").first())?.status).toBe("pending");
});
it("holds free orders when Stripe returns a different email without losing the coupon identity", async () => {
  await privateOffer();
  mockStripe("cs_free", 0);
  const form = payload(); form.set("couponCode", "PRIVATE-FREE-TEST"); form.set("couponEmail", "free@example.com");
  const id = String(form.get("attemptId"));
  expect((await api(request(form), bindings)).status).toBe(200);
  expect((await webhook(id, "cs_free", { paid: "no_payment_required", amount: 0, email: "different@example.com" })).status).toBe(200);
  expect(await env.DB.prepare("SELECT status,delivery_status,email,coupon_email FROM orders WHERE id=?").bind(id).first())
    .toEqual({ status: "paid", delivery_status: "needs_review", email: "different@example.com", coupon_email: "free@example.com" });
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox").first())?.n).toBe(0);
});
it("keeps a first-order redemption tied to its original email after Stripe contact changes", async () => {
  mockStripe("cs_email_change", 630);
  const form = payload(); form.set("couponCode", "WELCOME10"); form.set("couponEmail", "parent@example.com");
  expect((await api(request(form), bindings)).status).toBe(200);
  form.set("couponEmail", "other@example.com");
  expect((await api(request(form), bindings)).status).toBe(409);
  expect((await webhook(String(form.get("attemptId")), "cs_email_change", { amount: 630, email: "other@example.com" })).status).toBe(200);
  expect((await preview("WELCOME10", "parent@example.com")).status).toBe(400);
  expect((await preview("WELCOME10", "other@example.com")).status).toBe(400);
});
it("reserves a first-order offer atomically across simultaneous attempts and releases it on expiry", async () => {
  const fetch = mockStripe("cs_reserved", 630);
  const forms = [payload(), payload()]; forms.forEach(f => { f.set("couponCode", "WELCOME10"); f.set("couponEmail", "parent@example.com"); });
  const responses = await Promise.all(forms.map(f => api(request(f), bindings)));
  expect(responses.filter(r => r.status === 200)).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM orders").first())?.n).toBe(1);
  const winner = String(forms[responses.findIndex(r => r.status === 200)].get("attemptId"));
  expect((await preview()).status).toBe(400);
  expect((await webhook(winner, "cs_reserved", { type: "checkout.session.expired" })).status).toBe(200);
  expect((await preview()).status).toBe(200);
  vi.restoreAllMocks(); mockStripe("cs_after_expiry", 630);
  const next = payload(); next.set("couponEmail", "parent@example.com"); next.set("couponCode", "WELCOME10");
  expect((await api(request(next), bindings)).status).toBe(200);
});
it("checks paid history including orders without coupons and normalizes customer email", async () => {
  mockStripe(); const form = payload(); form.set("couponEmail", "parent@example.com"); await api(request(form), bindings);
  await webhook(String(form.get("attemptId")));
  await env.DB.prepare("UPDATE orders SET email=' Parent@Example.com '").run();
  expect((await preview("WELCOME10", "PARENT@example.com")).status).toBe(400);
});
it("enforces enabled dates and global limits again at checkout, not just at preview", async () => {
  const fetch = mockStripe("cs_limited", 630);
  expect((await preview()).status).toBe(200);
  const form = payload(); form.set("couponEmail", "parent@example.com"); form.set("couponCode", "WELCOME10");
  await env.DB.prepare("UPDATE coupons SET enabled=0 WHERE id='welcome10'").run();
  expect((await api(request(form), bindings)).status).toBe(400);
  await env.DB.prepare("UPDATE coupons SET enabled=1,starts_at=? WHERE id='welcome10'").bind(Date.now() + 60000).run();
  expect((await preview()).status).toBe(400);
  await env.DB.prepare("UPDATE coupons SET starts_at=NULL,expires_at=1 WHERE id='welcome10'").run();
  expect((await preview()).status).toBe(400);
  await env.DB.prepare("UPDATE coupons SET expires_at=NULL,max_redemptions=1 WHERE id='welcome10'").run();
  const other = payload(); other.set("couponEmail", "other@example.com"); other.set("couponCode", "WELCOME10");
  const results = await Promise.all([api(request(form), bindings), api(request(other), bindings)]);
  expect(results.filter(r => r.status === 200)).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("retains a coupon price and reservation across Stripe failures and coupon edits", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "Unavailable", type: "invalid_request_error" } }, { status: 400 }));
  const form = payload(); form.set("couponEmail", "parent@example.com"); form.set("couponCode", "WELCOME10");
  expect((await api(request(form), bindings)).status).toBe(503);
  expect((await preview()).status).toBe(400);
  await env.DB.prepare("UPDATE coupons SET percent_off=5,enabled=0 WHERE id='welcome10'").run();
  vi.restoreAllMocks(); mockStripe("cs_retry_coupon", 630);
  expect((await api(request(form), bindings)).status).toBe(200);
  form.delete("couponCode");
  expect((await api(request(form), bindings)).status).toBe(409);
});
it("migrates historical prices without dropping cards, tracking sessions or notifications", async () => {
  await reset();
  const apply = async (sql: string) => env.DB.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => env.DB.prepare(s)));
  await apply([baseSchema, companionSchema, postcardSchema, trackingSchema, deliverySchema, stripeDeliverySchema].join("\n"));
  await env.DB.prepare(`INSERT INTO orders(id,request_hash,access_token,book,child_name,first_name,last_name,email,address,postal_code,city,amount_cents,payment_mode,consent_version,created_at,status) VALUES ('old','hash','token','ski','Camille','Alex','Exemple','parent@example.com','Rue du Test','75001','Paris',1650,'test','test',1,'paid')`).run();
  await env.DB.prepare("INSERT INTO order_cards(order_id,position,adventure,updated_at) VALUES ('old',1,'ski',1)").run();
  await env.DB.prepare("INSERT INTO tracking_sessions VALUES ('session','old',9999)").run();
  await env.DB.prepare("INSERT INTO notification_outbox(id,order_id,kind,created_at,available_at) VALUES ('notification','old','confirmation',1,1)").run();
  await apply(couponSchema);
  expect(await env.DB.prepare("SELECT amount_cents,subtotal_cents,coupon_discount_cents FROM orders WHERE id='old'").first()).toEqual({ amount_cents: 1650, subtotal_cents: 1650, coupon_discount_cents: 0 });
  for (const table of ["order_cards", "tracking_sessions", "notification_outbox"])
    expect((await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first())?.n).toBe(1);
});
