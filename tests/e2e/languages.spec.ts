import { test, expect } from "@playwright/test";

const translations = {
  en: { heading: "Little companions. Very big adventures.", next: "Continue", done: "DEMO COMPLETE", cards: "cards", view: "See front and back" },
  de: { heading: "Kleine Begleiter. Ganz große Abenteuer.", next: "Weiter", done: "DEMO ABGESCHLOSSEN", cards: "Karten", view: "Vorder- und Rückseite ansehen" },
  es: { heading: "Sus pequeños compañeros. Grandes aventuras.", next: "Continuar", done: "DEMOSTRACIÓN TERMINADA", cards: "postales", view: "Ver el anverso y el reverso" },
};
for (const [locale, copy] of Object.entries(translations)) {
  test(`${locale} navigation, preview, order and tracking stay translated`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/${locale}/`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("h1")).toHaveText(copy.heading);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/${locale}/$`));
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(5);
    await page.locator("[data-preview]").first().click();
    await page.locator("#preview-flip").click();
    await expect(page.locator("#preview-text")).not.toContainText("Le soleil me chatouille");
    await expect(page.locator("#preview-create")).toHaveAttribute("href", new RegExp(`^/${locale}/personnaliser`));
    await page.locator("#close-preview").click();
    await page.screenshot({ path: `.context/home-${locale}-${testInfo.project.name}.png`, fullPage: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `.context/preview-${locale}-${testInfo.project.name}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);

    await page.goto(`/${locale}/personnaliser?cartes=3&compagnon=doudou`);
    await expect(page.locator('[name="cardLocale"]')).toHaveValue(locale);
    await page.locator('[name="cardLocale"]').selectOption("fr");
    await page.locator('[name="childName"]').fill("Alex");
    await page.locator("#pacifierPhoto").setInputFiles("public/images/doudou-ski.webp");
    await expect(page.locator("#summary-quantity")).toContainText(copy.cards);
    await page.locator("#next-step").click();
    await expect(page.locator("#review-language")).toContainText("Français");
    await page.locator('[name="termsConsent"]').check();
    await page.locator("#next-step").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/confirmation\\?demo=1`));
    await expect(page.locator("#status-label")).toHaveText(copy.done);
    await page.locator("#follow-cards").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/suivi\\?demo=1`));
    await expect(page.locator("#tracking-cards li")).toHaveCount(3);
    await expect(page.locator("#tracking-progress")).not.toContainText("expédiées");
    expect(errors).toEqual([]);
  });
}

test("language switch preserves the page without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/en/aventures");
  await page.locator(".language-switch summary").click();
  await page.locator('[data-language="de"]').click();
  await expect(page).toHaveURL(/\/de\/aventures\?lang=de$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await context.close();
});

for (const [browserLocale, expected] of [["de-DE", "de"], ["en-US", "en"], ["es-MX", "es"], ["ja-JP", "fr"]]) {
  test(`homepage detects ${browserLocale} without JavaScript`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: browserLocale, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/?campaign=test#questions");
    await expect(page.locator("html")).toHaveAttribute("lang", expected);
    expect(new URL(page.url()).searchParams.get("campaign")).toBe("test");
    expect(new URL(page.url()).hash).toBe("#questions");
    await context.close();
  });
}

test("manual French and Spanish choices override the browser on later visits", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: "de-DE" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.locator(".language-switch summary").click();
  await page.locator('[data-language="fr"]').click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.locator(".language-switch summary").click();
  await page.locator('[data-language="es"]').click();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  const cookie = (await context.cookies()).find(cookie => cookie.name === "mt_language")!;
  expect(cookie.value).toBe("es");
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86400);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.goto("/en/aventures");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await context.close();
});

test("manual French selection persists without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: "en-US", javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator(".language-switch summary").click();
  await page.locator('[data-language="fr"]').click();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await context.close();
});

test("language negotiation cannot be cached across visitors", async ({ request }) => {
  const english = await request.get("/", { headers: { "Accept-Language": "en-US" }, maxRedirects: 0 });
  expect(english.status()).toBe(307);
  expect(english.headers()["location"]).toMatch(/\/en\/$/);
  for (const response of [english, await request.get("/", { headers: { "Accept-Language": "fr-FR" } })]) {
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["vary"]).toContain("Accept-Language");
    expect(response.headers()["vary"]).toContain("Cookie");
  }
});

test("language switch preserves order query parameters", async ({ page }) => {
  await page.goto("/en/personnaliser?cartes=3&compagnon=doudou");
  await page.locator(".language-switch summary").click();
  await page.locator('[data-language="es"]').click();
  await expect(page).toHaveURL("/es/personnaliser?cartes=3&compagnon=doudou");
  await expect(page.locator('[name="quantity"][value="3"]')).toBeChecked();
  await expect(page.locator('[name="companion"][value="doudou"]')).toBeChecked();
});

test("localized missing pages retain their language and private pages cannot be cached", async ({ request }) => {
  for (const locale of ["en", "de", "es"]) {
    const missing = await request.get(`/${locale}/not-a-real-page`);
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain(`<html lang="${locale}">`);
    expect(missing.headers()["x-robots-tag"]).toContain("noindex");
    const privatePage = await request.get(`/${locale}/suivi`);
    expect(privatePage.headers()["cache-control"]).toBe("private, no-store");
    expect(privatePage.headers()["x-robots-tag"]).toContain("noindex");
  }
});
