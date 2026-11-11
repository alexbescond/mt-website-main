import { handle } from "@astrojs/cloudflare/handler";
import { api } from "./lib/api";
import { cleanupOrders } from "./lib/payments";
import { sendNotifications } from "./lib/notifications";
import { robots, sitemap, isPrivatePage } from "./lib/seo";
import { localeFromPath, unlocalizedPath } from "./lib/i18n/core";
import { languagePreference } from "./lib/i18n/preferences";
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const preference = languagePreference(request);
    const indexable =
      env.SITE_INDEXABLE === "true" && url.origin === env.SITE_ORIGIN;
    let response: Response;
    if (preference.location)
      response = new Response(null, { status: 307, headers: { Location: preference.location } });
    else if (url.pathname === "/robots.txt")
      response = new Response(
        indexable
          ? robots(env.SITE_ORIGIN)
          : "User-agent: *\nDisallow: /\n",
        { headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    else if (url.pathname === "/sitemap.xml")
      response = new Response(
        sitemap(env.SITE_ORIGIN),
        { headers: { "Content-Type": "application/xml" } },
      );
    else if (url.pathname.startsWith("/api/"))
      response = await api(request, env);
    else response = await handle(request, env, ctx);
    const locale = localeFromPath(url.pathname);
    if (response.status === 404 && locale !== "fr") {
      const fallback = await env.ASSETS.fetch(new Request(new URL(`/${locale}/404.html`, url), { method: request.method === "HEAD" ? "HEAD" : "GET" }));
      if (fallback.ok) response = new Response(fallback.body, { status: 404, headers: fallback.headers });
    }
    if (unlocalizedPath(url.pathname) === "/404") response = new Response(response.body, { status: 404, headers: response.headers });
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
    const privatePage = isPrivatePage(url.pathname);
    if (!indexable || privatePage || response.status >= 400)
      response.headers.set("X-Robots-Tag", "noindex, nofollow");
    if (privatePage) response.headers.set("Cache-Control", "private, no-store");
    if (preference.personalized) {
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.append("Vary", "Accept-Language, Cookie");
    }
    if (preference.cookie) response.headers.append("Set-Cookie", preference.cookie);
    if (url.protocol === "https:")
      response.headers.set("Strict-Transport-Security", "max-age=31536000");
    return response;
  },
  async scheduled(event, env) {
    await sendNotifications(env);
    if (event.cron === "17 3 * * *") {
      await cleanupOrders(env);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM tracking_sessions WHERE expires_at<?").bind(Date.now()),
        env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<?").bind(Date.now()),
      ]);
    }
  },
} satisfies ExportedHandler<Env>;
