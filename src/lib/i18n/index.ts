import en from "./en.json";
import de from "./de.json";
import es from "./es.json";
import { createTranslator, localizedPath, localeFromPath, type Locale, type Messages } from "./core";
import { getCatalog } from "../catalog";
export * from "./core";
export const messages: Record<Locale, Messages> = { fr: {}, en, de, es };
export function translator(locale: Locale) { return createTranslator(messages[locale]); }
export function getI18n(url: URL) {
  const locale = localeFromPath(url.pathname);
  const t = translator(locale);
  return { locale, t, localPath: (path: string) => localizedPath(path, locale), catalog: getCatalog(locale, t) };
}
