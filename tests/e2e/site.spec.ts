import { test, expect } from "@playwright/test";
test("home, illustrations, postcard preview, FAQ and navigation work", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Ses petits",
  );
  await expect(page.locator(".book-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Voir la carte Sous les cocotiers" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#preview-counter")).toHaveText("Recto · 1 / 2");
  await page.getByRole("button", { name: "Voir le verso" }).click();
  await expect(page.locator("#preview-counter")).toHaveText("Verso · 2 / 2");
  await page.getByRole("button", { name: "Fermer l’aperçu" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: "La photo de mon enfant est-elle obligatoire ?" })
    .click();
  await expect(
    page.getByText(
      "Non, seule la photo de son compagnon est nécessaire.",
      {
        exact: false,
      },
    ),
  ).toBeVisible();
  await expect.poll(() =>
    page
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
      () => document.documentElement.scrollWidth,
    ),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(errors).toEqual([]);
  await page.locator(".site-header").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `.context/home-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("personalization with only the companion photo, editing and no data transmission", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  await page.goto("/personnaliser?aventure=ski");
  await expect(page.locator("#mode-notice")).toContainText("démonstration");
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.locator("#summary-title")).toHaveText(
    "Tétine — La tête dans les flocons",
  );
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator('[data-step="0"]')).toBeVisible();
  await page.getByLabel("Le prénom de votre enfant").fill("Camille");
  await page
    .locator("#pacifierPhoto")
    .setInputFiles("public/images/tetine-transat.webp");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator("#review-child")).toContainText("Camille");
  await expect(page.locator("#review-photos img")).toHaveCount(1);
  await page.locator('[data-edit="0"]').click();
  await page.getByLabel("Le prénom de votre enfant").fill("Léon");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator("#review-child")).toContainText("Léon");
  await page.locator('[name="termsConsent"]').check();
  await page.getByRole("button", { name: "Terminer la démonstration" }).click();
  await expect(page).toHaveURL(/confirmation\?demo=1/);
  await expect(page.locator("#status-copy")).toContainText("Aucun paiement");
  expect(posts).toEqual([]);
});
test("invalid companion photos can be replaced with a valid image", async ({
  page,
}) => {
  await page.goto("/personnaliser");
  await page.locator("#pacifierPhoto").setInputFiles({
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
  await expect(page.locator(".upload-preview")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
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

test("doudou preselection, nickname and companion photo label are reflected in the summary", async ({
  page,
}) => {
  await page.goto("/personnaliser?compagnon=doudou&aventure=tropiques");
  await expect(
    page.locator('[name="companion"][value="doudou"]'),
  ).toBeChecked();
  await expect(page.locator("#summary-title")).toHaveText(
    "Doudou — Sous les cocotiers",
  );
  await expect(page.locator("#companion-photo-label")).toHaveText(
    "La photo de son doudou",
  );
  await expect(page.locator("#summary-image")).toHaveAttribute("src", "/images/doudou-transat.webp");
  await page.getByLabel("Le petit nom de son compagnon").fill("Lapinou");
  await page.locator('[name="companion"][value="tetine"]').check();
  await expect(page.locator("#summary-title")).toHaveText(
    "Tétine — Sous les cocotiers",
  );
  await expect(page.locator("#companion-photo-label")).toHaveText(
    "La photo de sa tétine",
  );
  await expect(page.locator("#summary-image")).toHaveAttribute("src", "/images/tetine-transat.webp");
});

test("switching companion and adventure updates the illustration and caption", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/personnaliser");
  const image = page.locator("#summary-image");
  const scenes = { tropiques: "transat", ski: "ski", plongee: "plongee", avion: "avion", aeroport: "enregistrement", safari: "safari", bateau: "bateau", pelleteuse: "pelleteuse", circuit: "circuit", espace: "espace", noel: "noel" };
  for (const [adventure, scene] of Object.entries(scenes)) {
    await page.locator("#adventure-1").selectOption(adventure);
    for (const companion of ["doudou", "tetine"]) {
      await page.locator(`[name="companion"][value="${companion}"]`).check();
      await expect(image).toHaveAttribute("src", `/images/${companion}-${scene}.webp`);
      await expect(image).toHaveAttribute("alt", new RegExp(companion === "doudou" ? "Doudou" : "Tétine"));
      await expect(page.locator("#summary-caption")).toHaveText(`EXEMPLE ILLUSTRÉ AVEC ${companion === "doudou" ? "DOUDOU" : "TÉTINE"}`);
      await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
test("catalogue, story and mobile navigation are reachable", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await expect(page.locator("#mobile-nav")).toBeVisible();
    await page
      .locator("#mobile-nav")
      .getByRole("link", { name: "Les aventures", exact: true })
      .click();
  } else {
    await page
      .locator(".desktop-nav")
      .getByRole("link", { name: "Les aventures", exact: true })
      .click();
  }
  await expect(page).toHaveURL(/aventures$/);
  await expect(page.locator(".book-card")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Explore l’espace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aide le Père Noël" })).toBeVisible();
  await expect(page.locator(".adventure-menu-visuals img")).toHaveCount(22);
  await page.goto("/notre-histoire");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "La place qu’ils prennent",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth,
    ),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
});


test("adventure menus disable used choices and release removed cards without creating duplicates", async ({ page }) => {
  await page.goto('/personnaliser?cartes=5&aventure=ski');
  const active = page.locator('select[name="adventure"]:enabled');
  const uniqueChoices = async () => {
    const values = await Promise.all((await active.all()).map(select => select.inputValue()));
    expect(new Set(values).size).toBe(values.length);
  };
  await expect(page.locator('#summary-cards li')).toHaveCount(5);
  await expect(page.locator('#adventure-1')).toHaveValue('ski');
  await uniqueChoices();
  await expect(page.locator('#adventure-1 option[value="ski"]')).toHaveJSProperty('disabled', false);
  await expect(page.locator('#adventure-2 option[value="ski"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#adventure-2 option[value="ski"]')).toHaveText('Au ski — déjà choisie · carte 1');
  await page.locator('#adventure-1').selectOption('noel');
  await expect(page.locator('#adventure-2 option[value="ski"]')).toHaveJSProperty('disabled', false);
  await expect(page.locator('#adventure-2 option[value="noel"]')).toHaveJSProperty('disabled', true);
  await page.locator('[name="quantity"][value="2"]').check();
  await expect(page.locator('#adventure-1 option[value="avion"]')).toHaveJSProperty('disabled', false);
  await expect(page.locator('#adventure-1 option[value="avion"]')).toHaveText('Prend l’avion');
  await page.locator('#adventure-1').selectOption('avion');
  const secondChoice = await page.locator('#adventure-2').inputValue();
  await page.locator('[name="quantity"][value="5"]').check();
  await expect(page.locator('#adventure-1')).toHaveValue('avion');
  await expect(page.locator('#adventure-2')).toHaveValue(secondChoice);
  await expect(page.locator('#adventure-5')).not.toHaveValue('avion');
  await uniqueChoices();
  const previewSources = await page.locator('#summary-cards img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
  expect(new Set(previewSources).size).toBe(5);
  await page.locator('[name="quantity"][value="1"]').check();
  await expect(page.locator('#adventure-1 option:disabled')).toHaveCount(0);
});

test("five postcards keep their itinerary, weekly cadence and price through editing", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
  await page.goto("/personnaliser?compagnon=doudou&cartes=5&aventure=safari");
  await expect(page.locator('#summary-total')).toHaveText("25,00 €");
  await expect(page.locator('select[name="adventure"]:enabled')).toHaveCount(5);
  await expect(page.locator('#adventure-1')).toHaveValue("safari");
  const choices = ["safari", "bateau", "pelleteuse", "espace", "noel"];
  for (let index = 0; index < choices.length; index++) await page.locator(`#adventure-${index + 1}`).selectOption(choices[index]);
  await expect(page.locator('#summary-single')).toBeHidden();
  await expect(page.locator('#summary-cards li')).toHaveCount(5);
  await expect(page.locator('#summary-title')).toContainText('Son voyage en 5 cartes');
  await expect(page.locator('#summary-cards li').last()).toContainText('Aide le Père Noël');
  await expect(page.locator('#summary-cards li').last()).toContainText('+ 28 jours');
  for (const companion of ['tetine', 'doudou']) {
    await page.locator(`[name="companion"][value="${companion}"]`).check();
    for (let index = 0; index < choices.length; index++) {
      await expect(page.locator('#summary-cards img').nth(index)).toHaveAttribute('src', `/images/${companion}-${choices[index]}.webp`);
    }
  }
  await expect.poll(() => page.locator('#summary-cards img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator('#adventure-3').selectOption('circuit');
  await expect(page.locator('#summary-cards img').nth(2)).toHaveAttribute('src', '/images/doudou-circuit.webp');
  await page.locator('[name="quantity"][value="2"]').check();
  await expect(page.locator('#summary-cards li')).toHaveCount(2);
  await expect(page.locator('#summary-total')).toHaveText("12,00 €");
  await expect(page.locator('select[name="adventure"]:enabled')).toHaveCount(2);
  await page.locator('[name="quantity"][value="5"]').check();
  await expect(page.locator('#summary-cards li')).toHaveCount(5);
  await expect(page.locator('#summary-cards img').nth(2)).toHaveAttribute('src', '/images/doudou-circuit.webp');
  await expect(page.locator('#adventure-5')).toHaveValue("noel");
  await page.getByLabel("Le prénom de votre enfant").fill("Camille");
  await page.getByLabel("Le petit nom de son compagnon").fill("Lapinou");
  await page.locator('#pacifierPhoto').setInputFiles('public/images/tetine-transat.webp');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.locator('#review-plan li')).toHaveCount(5);
  await expect(page.locator('#review-plan li').last()).toContainText('+ 28 jours');
  await expect(page.locator('#review-companion')).toContainText('Lapinou');
  await expect(page.locator('#review-book')).toContainText('25,00 €');
  await page.locator('[data-edit="0"]').click();
  await page.locator('[name="quantity"][value="1"]').check();
  await expect(page.locator('#summary-bundle')).toBeHidden();
  await expect(page.locator('#summary-single')).toBeVisible();
  await expect(page.locator('#summary-cards li')).toHaveCount(0);
  await expect(page.locator('#summary-image')).toHaveAttribute('src', '/images/doudou-safari.webp');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.locator('#review-plan li')).toHaveCount(1);
  await expect(page.locator('#review-book')).toContainText('7,00 €');
  await page.locator('[name="termsConsent"]').check();
  await page.getByRole('button', { name: 'Terminer la démonstration' }).click();
  await expect(page).toHaveURL(/confirmation\?demo=1/);
  expect(posts).toEqual([]);
});
