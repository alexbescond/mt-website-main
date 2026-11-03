import {
  checkoutAvailable,
  createCheckout,
  orderStatus,
  stripeWebhook,
} from "./payments";
import { InputError } from "./validation";
import { previewCoupon } from "./coupons";
import { adminLogin, adminLogout, exchangeTrackingLink, trackingAfterCheckout } from "./tracking-auth";
import { adminPhoto, customerTracking, listAdminOrders, requestTrackingEmail, retryNotifications, scheduleOrder, updateCard } from "./tracking";
export async function api(request: Request, env: AppEnv): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/api/tracking" && request.method === "GET")
      return await customerTracking(request, env);
    if (url.pathname === "/api/tracking/access" && request.method === "POST")
      return await exchangeTrackingLink(request, env);
    if (url.pathname === "/api/tracking/checkout" && request.method === "POST")
      return await trackingAfterCheckout(request, env);
    if (url.pathname === "/api/tracking/email" && request.method === "POST")
      return await requestTrackingEmail(request, env);
    if (url.pathname === "/api/admin/login" && request.method === "POST")
      return await adminLogin(request, env);
    if (url.pathname === "/api/admin/logout" && request.method === "POST")
      return await adminLogout(request, env);
    if (url.pathname === "/api/admin/orders" && request.method === "GET")
      return await listAdminOrders(request, env);
    const card = /^\/api\/admin\/orders\/([a-f0-9-]{36})\/cards\/([1-5])$/.exec(url.pathname);
    if (card && request.method === "POST")
      return await updateCard(request, env, card[1], Number(card[2]));
    const schedule = /^\/api\/admin\/orders\/([a-f0-9-]{36})\/schedule$/.exec(url.pathname);
    if (schedule && request.method === "POST")
      return await scheduleOrder(request, env, schedule[1]);
    const photo = /^\/api\/admin\/orders\/([a-f0-9-]{36})\/photo$/.exec(url.pathname);
    if (photo && request.method === "GET")
      return await adminPhoto(request, env, photo[1]);
    const retry = /^\/api\/admin\/orders\/([a-f0-9-]{36})\/notifications\/retry$/.exec(url.pathname);
    if (retry && request.method === "POST")
      return await retryNotifications(request, env, retry[1]);
    if (url.pathname === "/api/config" && request.method === "GET")
      return Response.json({
        mode: env.CHECKOUT_MODE,
        available: checkoutAvailable(env, url),
      });
    if (url.pathname === "/api/health" && request.method === "GET") {
      await env.DB.prepare("SELECT 1 FROM orders LIMIT 1").first();
      return Response.json({
        ok: true,
        checkout: checkoutAvailable(env, url),
        mode: env.CHECKOUT_MODE,
      });
    }
    if (url.pathname === "/api/checkout" && request.method === "POST")
      return await createCheckout(request, env);
    if (url.pathname === "/api/coupon" && request.method === "POST")
      return await previewCoupon(request, env);
    if (url.pathname === "/api/stripe/webhook" && request.method === "POST")
      return await stripeWebhook(request, env);
    if (url.pathname === "/api/order-status" && request.method === "GET")
      return await orderStatus(request, env);
    if (
      [
        "/api/config",
        "/api/health",
        "/api/checkout",
        "/api/coupon",
        "/api/stripe/webhook",
        "/api/order-status",
      ].includes(url.pathname)
    )
      return Response.json(
        { error: "Méthode non autorisée." },
        { status: 405 },
      );
    return Response.json({ error: "Ressource introuvable." }, { status: 404 });
  } catch (error) {
    if (error instanceof InputError)
      return Response.json({ error: error.message }, { status: error.status });
    // Do not log payloads, Stripe responses, names, addresses, photos or secret values.
    console.error(
      JSON.stringify({
        event: "api_failure",
        path: new URL(request.url).pathname,
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
    return Response.json(
      {
        error:
          "Une erreur temporaire est survenue. Réessayez dans quelques instants.",
      },
      { status: 503 },
    );
  }
}
