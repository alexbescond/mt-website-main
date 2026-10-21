import { test, expect } from "@playwright/test";
test("home, illustrations, book preview, FAQ and navigation work", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Une petite tétine.",
  );
  await expect(page.locator(".book-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Feuilleter Tétine va sous les tropiques" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#preview-counter")).toHaveText("1 / 6");
  await page.getByRole("button", { name: "Page suivante" }).click();
  await expect(page.locator("#preview-counter")).toHaveText("2 / 6");
  await page.getByRole("button", { name: "Fermer l’aperçu" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "La photo de mon enfant est-elle obligatoire ?" })
    .click();
  await expect(
    page.getByText("Non, seule la photo de la tétine est nécessaire.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(
    await page
      .locator("img")
      .evaluateAll((images) =>
        images
          .filter(
            (img) =>
              !(img as HTMLImageElement).complete ||
              !(img as HTMLImageElement).naturalWidth,
          )
          .map((img) => (img as HTMLImageElement).src),
      ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.locator(".site-header").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `.context/home-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("personalization to demo confirmation, optional portrait, editing and no data transmission", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  await page.goto("/personnaliser?aventure=ski");
  await expect(page.locator("#mode-notice")).toContainText("démonstration");
  await expect(page.locator("#summary-title")).toHaveText("Tétine va au ski");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator('[data-step="0"]')).toBeVisible();
  await page.getByLabel("Le prénom de votre enfant").fill("Camille");
  await page
    .locator("#pacifierPhoto")
    .setInputFiles("public/images/tetine-transat.webp");
  await page.locator('[name="photoConsent"]').check();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByLabel("Votre prénom", { exact: false }).fill("Alex");
  await page.getByLabel("Votre nom", { exact: false }).fill("Exemple");
  await page.getByLabel("Votre adresse e-mail").fill("parent@example.com");
  await page
    .getByLabel("Adresse de livraison", { exact: false })
    .fill("1 rue du Test");
  await page.getByLabel("Code postal").fill("75001");
  await page.getByLabel("Ville", { exact: false }).fill("Paris");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator("#review-child")).toContainText("Camille");
  await expect(page.locator("#review-photos img")).toHaveCount(1);
  await page.locator('[data-edit="0"]').click();
  await page.getByLabel("Le prénom de votre enfant").fill("Léon");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator("#review-child")).toContainText("Léon");
  await page.locator('[name="termsConsent"]').check();
  await page.getByRole("button", { name: "Terminer la démonstration" }).click();
  await expect(page).toHaveURL(/confirmation\?demo=1/);
  await expect(page.locator("#status-copy")).toContainText("Aucun paiement");
  expect(posts).toEqual([]);
});
test("invalid files can be replaced and an optional portrait removed", async ({
  page,
}) => {
  await page.goto("/personnaliser");
  await page
    .locator("#pacifierPhoto")
    .setInputFiles({
      name: "file.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
  await expect(page.locator("#pacifier-error")).toContainText(
    "Choisissez une image",
  );
  await page
    .locator("#pacifierPhoto")
    .setInputFiles("public/images/tetine-transat.webp");
  await expect(page.locator("#pacifier-error")).toBeEmpty();
  await page
    .locator("#childPhoto")
    .setInputFiles("public/images/tetine-avion.webp");
  await expect(page.locator("#remove-child")).toBeVisible();
  await page.getByRole("button", { name: "Retirer le portrait" }).click();
  await expect(page.locator("#remove-child")).toBeHidden();
});
test("private endpoints, cancel, 404 and noindex behave correctly", async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post("/api/checkout", {
        headers: { Origin: "http://127.0.0.1:8790" },
      })
    ).status(),
  ).toBe(503);
  expect((await request.get("/api/order-status")).status()).toBe(404);
  expect((await request.get("/")).headers()["x-robots-tag"]).toContain(
    "noindex",
  );
  expect(
    (await request.get("/personnaliser")).headers()["cache-control"],
  ).toContain("no-store");
  await page.goto("/personnaliser?annule=1");
  await expect(page.locator("#cancel-notice")).toBeVisible();
  const response = await page.goto("/inconnue");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "vacances",
  );
});
