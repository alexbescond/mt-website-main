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
import stripePromotionsSchema from "../../migrations/0008_stripe_promotions.sql?raw";
const schema = baseSchema + "\n" + companionSchema + "\n" + postcardSchema + "\n" + trackingSchema + "\n" + deliverySchema + "\n" + stripeDeliverySchema + "\n" + couponSchema + "\n" + stripePromotionsSchema;
import { api } from "../../src/lib/api";
import { checkoutAvailable, cleanupOrders, stripeClient } from "../../src/lib/payments";
import { limitedBody, validatePhoto } from "../../src/lib/validation";

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
      expect([...body.entries()].filter(([key]) => key.startsWith("shipping_address_collection[allowed_countries]")))
        .toEqual(["FR", "BE", "LU", "CH"].map((country, index) => [
          `shipping_address_collection[allowed_countries][${index}]`, country,
        ]));
      expect(body.has("customer_email")).toBe(false);
      expect(body.get("allow_promotion_codes")).toBe("true");
      expect(body.get("payment_method_collection")).toBe("if_required");
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
    subtotal?: number;
    discount?: number;
    tax?: number;
    shippingAmount?: number;
    currency?: string;
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
        amount_subtotal: opts.subtotal ?? (opts.amount ?? 700) + (opts.discount ?? 0),
        total_details: { amount_discount: opts.discount ?? 0, amount_tax: opts.tax ?? 0, amount_shipping: opts.shippingAmount ?? 0 },
        currency: opts.currency ?? "eur",
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
  { country: "BE", postal_code: "1000", city: "Bruxelles" },
  { country: "LU", postal_code: "1234", city: "Luxembourg" },
  { country: "CH", postal_code: "1201", city: "Genève" },
  { country: "CH", postal_code: "9470", city: "Buchs" },
])("accepts delivery and schedules confirmation for supported countries: %j", async address => {
  mockStripe();
  const form = payload();
  const id = String(form.get("attemptId"));
  await api(request(form), bindings);
  expect((await webhook(id, "cs_test_fixture", {
    shipping: { name: "Alex", address: { line1: "1 rue du Test", ...address } },
  })).status).toBe(200);
  expect(await env.DB.prepare("SELECT status,delivery_status,country,postal_code,city FROM orders WHERE id=?").bind(id).first())
    .toEqual({ status: "paid", delivery_status: "ready", ...address });
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE order_id=?").bind(id).first())?.n).toBe(1);
});

it.each([
  null,
  { name: "Alex", address: { country: "FR" } },
  { name: "Alex", address: { line1: "1 rue du Test", postal_code: "97400", city: "Saint-Denis", country: "FR" } },
  { name: "Alex", address: { line1: "1 rue du Test", postal_code: "98000", city: "Monaco", country: "FR" } },
  { name: "Alex", address: { line1: "1 rue du Test", postal_code: "10115", city: "Berlin", country: "DE" } },
  ...["BE", "LU", "CH"].flatMap(country => ["", "123", "12345", "ABCD"].map(postal_code => (
    { name: "Alex", address: { line1: "1 rue du Test", postal_code, city: "Test", country } }
  ))),
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

it("migrates historical prices without dropping cards, tracking sessions or notifications", async () => {
  await reset();
  const apply = async (sql: string) => env.DB.batch(sql.split(";").map(s => s.trim()).filter(Boolean).map(s => env.DB.prepare(s)));
  await apply([baseSchema, companionSchema, postcardSchema, trackingSchema, deliverySchema, stripeDeliverySchema].join("\n"));
  await env.DB.prepare(`INSERT INTO orders(id,request_hash,access_token,book,child_name,first_name,last_name,email,address,postal_code,city,amount_cents,payment_mode,consent_version,created_at,status) VALUES ('old','hash','token','ski','Camille','Alex','Exemple','parent@example.com','Rue du Test','75001','Paris',1650,'test','test',1,'paid')`).run();
  await env.DB.prepare("INSERT INTO order_cards(order_id,position,adventure,updated_at) VALUES ('old',1,'ski',1)").run();
  await env.DB.prepare("INSERT INTO tracking_sessions VALUES ('session','old',9999)").run();
  await env.DB.prepare("INSERT INTO notification_outbox(id,order_id,kind,created_at,available_at) VALUES ('notification','old','confirmation',1,1)").run();
  await apply(couponSchema);
  await apply(stripePromotionsSchema);
  expect(await env.DB.prepare("SELECT amount_cents,subtotal_cents,coupon_discount_cents FROM orders WHERE id='old'").first()).toEqual({ amount_cents: 1650, subtotal_cents: 1650, coupon_discount_cents: 0 });
  for (const table of ["order_cards", "tracking_sessions", "notification_outbox"])
    expect((await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first())?.n).toBe(1);
});

function mockPromotion(amount: number, code = "WELCOME10") {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    expect(url.origin + url.pathname).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_fixture");
    expect(url.searchParams.get("expand[0]")).toBe("discounts.promotion_code");
    return Response.json({ id: "cs_test_fixture", amount_total: amount, discounts: [{
      coupon: { id: "coupon_fixture" },
      promotion_code: { id: "promo_fixture", code },
    }] });
  });
}

it("uses Stripe promotions without accepting client discount amounts or eligibility emails", async () => {
  mockStripe();
  const form = payload();
  form.set("amountCents", "0");
  form.set("couponDiscountCents", "700");
  form.set("couponExpectedTotal", "0");
  form.set("couponEmail", "free@example.com");
  const response = await api(request(form), bindings);
  expect(response.status).toBe(200);
  expect(await env.DB.prepare("SELECT subtotal_cents,amount_cents,coupon_email,discount_source FROM orders").first())
    .toEqual({ subtotal_cents: 700, amount_cents: 700, coupon_email: null, discount_source: "stripe" });
  expect((await api(new Request(`${origin}/api/coupon`, { method: "POST" }), bindings)).status).toBe(404);
});

it("asks older forms to reload instead of silently dropping an applied discount", async () => {
  const fetch = mockStripe();
  const form = payload(); form.set("couponCode", "WELCOME10");
  expect((await api(request(form), bindings)).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
  expect((await env.DB.prepare("SELECT count(*) AS n FROM orders").first())?.n).toBe(0);
});

it.each([[70, 630], [200, 500], [700, 0]])("records Stripe's %i-cent discount and confirms the %i-cent total once", async (discount, total) => {
  mockStripe();
  const form = payload(); const id = String(form.get("attemptId"));
  const response = await api(request(form), bindings);
  const fetch = mockPromotion(total, total === 0 ? "FREE-TEST" : "WELCOME10");
  fetch.mockClear();
  const opts = { amount: total, discount, paid: total === 0 ? "no_payment_required" : "paid" };
  expect((await webhook(id, "cs_test_fixture", { ...opts, paid: "unpaid" })).status).toBe(200);
  expect(fetch).not.toHaveBeenCalled();
  expect((await env.DB.prepare("SELECT status FROM orders").first())?.status).toBe("pending");
  expect((await webhook(id, "cs_test_fixture", opts)).status).toBe(200);
  expect((await webhook(id, "cs_test_fixture", opts)).status).toBe(200);
  expect((await webhook(id, "cs_test_fixture", { type: "checkout.session.expired" })).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare("SELECT * FROM orders").first()).toMatchObject({
    status: "paid", subtotal_cents: 700, amount_cents: total, coupon_discount_cents: discount,
    stripe_promotion_code_id: "promo_fixture", stripe_coupon_id: "coupon_fixture",
    stripe_promotion_code: total === 0 ? "FREE-TEST" : "WELCOME10", delivery_status: "ready",
    email: "parent@example.com", coupon_email: null,
  });
  expect((await env.DB.prepare("SELECT count(*) AS n FROM order_cards").first())?.n).toBe(1);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox").first())?.n).toBe(1);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  expect(await (await api(new Request(`${origin}/api/order-status`, { headers: { cookie } }), bindings)).json())
    .toMatchObject({ status: "paid", free: total === 0 });
});

it("keeps Stripe's rounding after the grouped delivery saving", async () => {
  mockStripe("cs_test_fixture", 475, 3);
  const form = payload(); form.set("quantity", "3"); form.set("deliveryMode", "together");
  form.append("adventure", "ski"); form.append("adventure", "espace");
  expect((await api(request(form), bindings)).status).toBe(200);
  mockPromotion(1282);
  expect((await webhook(String(form.get("attemptId")), "cs_test_fixture", { amount: 1282, subtotal: 1425, discount: 143 })).status).toBe(200);
  expect(await env.DB.prepare("SELECT subtotal_cents,amount_cents,coupon_discount_cents FROM orders").first())
    .toEqual({ subtotal_cents: 1425, amount_cents: 1282, coupon_discount_cents: 143 });
});

it.each([
  { amount: 630, subtotal: 800, discount: 170 },
  { amount: 630, subtotal: 700, discount: 60 },
  { amount: 0, subtotal: 700, discount: 701 },
  { amount: 700, subtotal: 700, discount: -1 },
  { amount: 629.5, subtotal: 700, discount: 70.5 },
  { amount: 630, subtotal: 700, discount: 70, tax: 10 },
  { amount: 630, subtotal: 700, discount: 70, shippingAmount: 10 },
  { amount: 630, subtotal: 700, discount: 70, currency: "usd" },
])("rejects inconsistent Stripe price details: %j", async opts => {
  const fetch = mockStripe(); const form = payload();
  await api(request(form), bindings);
  fetch.mockClear();
  expect((await webhook(String(form.get("attemptId")), "cs_test_fixture", opts)).status).toBe(409);
  expect(fetch).not.toHaveBeenCalled();
  expect((await env.DB.prepare("SELECT status FROM orders").first())?.status).toBe("pending");
  expect((await env.DB.prepare("SELECT count(*) AS n FROM order_cards").first())?.n).toBe(0);
});

it("never fulfils a nonzero session marked no_payment_required", async () => {
  mockStripe(); const form = payload(); await api(request(form), bindings);
  expect((await webhook(String(form.get("attemptId")), "cs_test_fixture", { paid: "no_payment_required" })).status).toBe(200);
  expect((await env.DB.prepare("SELECT status FROM orders").first())?.status).toBe("pending");
});

it("retries promotion lookup failures without recording payment or releasing fulfilment", async () => {
  mockStripe(); const form = payload(); await api(request(form), bindings);
  const id = String(form.get("attemptId"));
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "Unavailable", type: "invalid_request_error" } }, { status: 400 }));
  expect((await webhook(id, "cs_test_fixture", { amount: 630, discount: 70 })).status).toBe(503);
  expect((await env.DB.prepare("SELECT status FROM orders").first())?.status).toBe("pending");
  expect((await env.DB.prepare("SELECT count(*) AS n FROM stripe_events").first())?.n).toBe(0);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM order_cards").first())?.n).toBe(0);
  mockPromotion(630);
  expect((await webhook(id, "cs_test_fixture", { amount: 630, discount: 70 })).status).toBe(200);
});

it("still confirms legacy fixed-price sessions and preserves their original email restriction", async () => {
  mockStripe(); const form = payload(); await api(request(form), bindings);
  const id = String(form.get("attemptId"));
  await env.DB.prepare("UPDATE orders SET discount_source='legacy',amount_cents=0,coupon_discount_cents=700,coupon_email='free@example.com' WHERE id=?").bind(id).run();
  expect((await webhook(id, "cs_test_fixture", { amount: 700 })).status).toBe(409);
  expect((await webhook(id, "cs_test_fixture", { amount: 0, paid: "no_payment_required" })).status).toBe(200);
  expect(await env.DB.prepare("SELECT status,delivery_status,amount_cents FROM orders").first())
    .toEqual({ status: "paid", delivery_status: "needs_review", amount_cents: 0 });
  expect((await env.DB.prepare("SELECT count(*) AS n FROM notification_outbox").first())?.n).toBe(0);
});
