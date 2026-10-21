import {
  checkoutAvailable,
  createCheckout,
  orderStatus,
  stripeWebhook,
} from "./payments";
import { InputError } from "./validation";
export async function api(request: Request, env: AppEnv): Promise<Response> {
  try {
    const url = new URL(request.url);
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
    if (url.pathname === "/api/stripe/webhook" && request.method === "POST")
      return await stripeWebhook(request, env);
    if (url.pathname === "/api/order-status" && request.method === "GET")
      return await orderStatus(request, env);
    if (
      [
        "/api/config",
        "/api/health",
        "/api/checkout",
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
