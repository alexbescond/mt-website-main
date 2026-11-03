import { test, expect } from "@playwright/test";

test("private follow-up offers recovery and never leaks data or credentials in URLs", async ({ page, request }) => {
  for (const route of ["/suivi", "/admin", "/api/tracking", "/api/admin/orders"]) {
    const response = await request.get(route);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  }
  await page.goto("/suivi#acces=invalid-token");
  await expect(page.locator("#tracking-access")).toBeVisible();
  await expect(page).toHaveURL(/\/suivi$/);
  await expect(page.locator("#tracking-content")).toBeHidden();
  await expect(page.getByLabel("Votre adresse e-mail")).toBeVisible();
});

test("customer itinerary is legible on desktop and mobile", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/suivi?demo=1");
  await expect(page.locator("#tracking-cards > li")).toHaveCount(3);
  await expect(page.locator("#tracking-progress")).toHaveText("1 carte sur 3 expédiée");
  await expect(page.locator("#tracking-companion")).toHaveText("Lapinou");
  await expect(page.locator("#demo-banner")).toContainText("Commande fictive");
  await expect(page.locator("#tracking-cards")).not.toContainText("Livrée");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(errors).toEqual([]);
  await page.screenshot({ path: ".context/suivi-" + testInfo.project.name + ".png", fullPage: true });
});

test("operator can prepare and dispatch a card and see the same update as the parent", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const posts: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
  await page.goto("/admin?demo=1");
  await expect(page.locator(".admin-order")).toHaveCount(1);
  await page.getByRole("button", { name: "À expédier aujourd’hui" }).click();
  await page.getByRole("button", { name: "Marquer comme prête" }).click();
  await expect(page.locator(".admin-card").nth(1)).toContainText("Prête à partir");
  await page.getByRole("button", { name: "Marquer comme expédiée" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.locator(".admin-card").nth(1)).toContainText("Prête à partir");
  await page.getByRole("button", { name: "Marquer comme expédiée" }).click();
  await page.getByRole("button", { name: "Confirmer l’envoi" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Toutes les commandes" }).click();
  await expect(page.locator(".admin-card").nth(1)).toContainText("Expédiée le");
  await page.locator(".admin-order summary").click();
  await expect(page.locator(".admin-customer")).toContainText("12 rue des Nuages");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: ".context/atelier-" + testInfo.project.name + ".png", fullPage: true });
  await page.getByRole("link", { name: "Ouvrir le suivi client" }).click();
  await expect(page.locator("#tracking-progress")).toHaveText("2 cartes sur 3 expédiées");
  await expect(page.locator("#tracking-cards > li").nth(1)).toContainText("Expédiée le");
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});
