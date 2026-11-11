import { isLocale, localeFromPath, localizedPath, requestLocale, unlocalizedPath } from "./core";

export const LANGUAGE_COOKIE = "mt_language";
const publicPages = new Set(["/", "/aventures", "/notre-histoire", "/informations", "/personnaliser", "/confirmation", "/suivi", "/404"]);
export function isLanguageEntry(path: string) {
  return ["/", "/index", "/index.html"].includes(path);
}

/** Explicit links win. Only the unprefixed home page negotiates a language. */
export function languagePreference(request: Request): { location?: string; cookie?: string; personalized: boolean } {
  if (request.method !== "GET" && request.method !== "HEAD") return { personalized: false };
  const url = new URL(request.url);
  const path = unlocalizedPath(url.pathname).replace(/\/$/, "") || "/";
  if (!publicPages.has(path)) return { personalized: false };

  const selected = url.searchParams.get("lang");
  if (isLocale(selected)) {
    const cookie = `${LANGUAGE_COOKIE}=${selected}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${url.protocol === "https:" ? "; Secure" : ""}`;
    // Keep the explicit parameter through this response, so the selection works
    // even when cookies or JavaScript are disabled. The browser removes it later.
    if (localeFromPath(url.pathname) !== selected) {
      url.pathname = localizedPath(path, selected);
      return { personalized: true, cookie, location: url.href };
    }
    return { personalized: true, cookie };
  }
  if (!isLanguageEntry(url.pathname)) return { personalized: false };

  const saved = request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(LANGUAGE_COOKIE + "="))?.slice(LANGUAGE_COOKIE.length + 1);
  const locale = isLocale(saved) ? saved : requestLocale(request);
  if (locale === "fr") return { personalized: true };
  url.pathname = localizedPath("/", locale);
  return { personalized: true, location: url.href };
}
