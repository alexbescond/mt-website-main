import { createTranslator, isLocale, localizedPath, type Messages } from "../lib/i18n/core";
import { getCatalog } from "../lib/catalog";
export const locale = isLocale(document.documentElement.lang) ? document.documentElement.lang : "fr";
const source = document.querySelector("#i18n-messages")?.textContent;
export const t = createTranslator(source ? JSON.parse(source) as Messages : {});
export const localPath = (path: string) => localizedPath(path, locale);
export const catalog = getCatalog(locale, t);
