export const locales = ["fr", "en", "de", "es"] as const;
export type Locale = (typeof locales)[number];
export const languageNames: Record<Locale, string> = { fr: "Français", en: "English", de: "Deutsch", es: "Español" };
export const localeTags: Record<Locale, string> = { fr: "fr-FR", en: "en-GB", de: "de-DE", es: "es-ES" };
export type Messages = Record<string, string>;
export type Translator = (source: string, ...values: (string | number)[]) => string;
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.some(locale => locale === value);
}
export function localeFromPath(path: string): Locale {
  const segment = path.replace(/\.html$/, "").split("/")[1];
  return isLocale(segment) ? segment : "fr";
}
export function requestLocale(request: Request): Locale {
  return preferredLocale(request.headers.get("Accept-Language"));
}
export function preferredLocale(header: string | null): Locale {
  const preferences = (header || "").split(",").map((entry, index) => {
    const [tag, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters.find(parameter => parameter.trim().startsWith("q="));
    const weight = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return { language: tag.split("-")[0], weight, index,
      valid: /^(?:[a-z]{2,8}(?:-[a-z0-9]{1,8})*|\*)$/.test(tag) && Number.isFinite(weight) && weight >= 0 && weight <= 1 };
  }).filter(entry => entry.valid);
  const excluded = new Set(preferences.filter(entry => entry.weight === 0).map(entry => entry.language));
  for (const preference of preferences.filter(entry => entry.weight > 0).sort((a, b) => b.weight - a.weight || a.index - b.index)) {
    if (isLocale(preference.language)) return preference.language;
    if (preference.language === "*") return locales.find(locale => !excluded.has(locale)) ?? "fr";
  }
  return "fr";
}
export function unlocalizedPath(path: string) {
  // Astro's file build format exposes .html while prerendering. Public links
  // and canonical URLs use the extensionless URLs served by Workers Assets.
  return path.replace(/\.html(?=$|[?#])/, "").replace(/^\/(en|de|es)(?=\/|$|[?#])/, "").replace(/^\/index(?=$|[?#])/, "/") || "/";
}
export function localizedPath(path: string, locale: Locale) {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const plain = unlocalizedPath(path);
  if (/^\/(api|admin|images|_astro)(\/|\?|$)/.test(plain)) return plain;
  return locale === "fr" ? plain : `/${locale}${plain}`;
}
export function createTranslator(messages: Messages = {}): Translator {
  return (source, ...values) => {
    const key = source.replace(/\s+/g, " ").trim();
    const translated = Object.hasOwn(messages, key) ? messages[key] : undefined;
    const text = translated === undefined ? source :
      (source.match(/^\s*/)?.[0] ?? "") + translated + (source.match(/\s*$/)?.[0] ?? "");
    return text.replace(/\{(\d+)\}/g, (match, index: string) => values[Number(index)] === undefined ? match : String(values[Number(index)]));
  };
}
