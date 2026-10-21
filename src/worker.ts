import { handle } from "@astrojs/cloudflare/handler";
import { api } from "./lib/api";
import { cleanupOrders } from "./lib/payments";
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const indexable =
      env.SITE_INDEXABLE === "true" && url.origin === env.SITE_ORIGIN;
    let response: Response;
    if (url.pathname === "/robots.txt")
      response = new Response(
        indexable
          ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /personnaliser\nDisallow: /confirmation\nSitemap: ${env.SITE_ORIGIN}/sitemap.xml\n`
          : "User-agent: *\nDisallow: /\n",
        { headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    else if (url.pathname === "/sitemap.xml")
      response = new Response(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${env.SITE_ORIGIN}/</loc></url></urlset>`,
        { headers: { "Content-Type": "application/xml" } },
      );
    else if (url.pathname.startsWith("/api/"))
      response = await api(request, env);
    else response = await handle(request, env, ctx);
    response = new Response(response.body, response);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com; base-uri 'self'; object-src 'none'",
    );
    const privatePage = /^\/(api|personnaliser|confirmation)(\/|\.|$)/.test(
      url.pathname,
    );
    if (!indexable || privatePage || response.status >= 400)
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    if (privatePage) response.headers.set("Cache-Control", "private, no-store");
    if (url.protocol === "https:")
      response.headers.set("Strict-Transport-Security", "max-age=31536000");
    return response;
  },
  async scheduled(_event, env) {
    await cleanupOrders(env);
  },
} satisfies ExportedHandler<AppEnv>;
