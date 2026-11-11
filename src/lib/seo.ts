import { locales, localizedPath, unlocalizedPath } from "./i18n/core";

export function isPrivatePage(path: string) {
  return /^\/(api|personnaliser|confirmation|suivi|admin)(\/|\.|$)/.test(unlocalizedPath(path));
}
export function robots(origin: string) {
  const privatePaths = locales.flatMap(locale => ["/personnaliser", "/confirmation", "/suivi"].map(path => localizedPath(path, locale)));
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n${privatePaths.map(path => `Disallow: ${path}\n`).join("")}Sitemap: ${origin}/sitemap.xml\n`;
}
export function sitemap(origin: string) {
  const pages = ["/", "/aventures", "/notre-histoire"];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${pages.flatMap(path => {
    const alternates = locales.map(locale => `<xhtml:link rel="alternate" hreflang="${locale}" href="${origin}${localizedPath(path, locale)}"/>`).join("") + `<xhtml:link rel="alternate" hreflang="x-default" href="${origin}${path}"/>`;
    return locales.map(locale => `<url><loc>${origin}${localizedPath(path, locale)}</loc>${alternates}</url>`);
  }).join("")}</urlset>`;
}
