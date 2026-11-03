import { test, expect } from "@playwright/test";

test("order reaches review without collecting contact details or premature errors", async ({ page }, testInfo) => {
  await page.goto("/personnaliser");
  const child = page.locator('[name="childName"]');
  await expect(child).toHaveCSS("border-top-color", "rgb(214, 220, 207)");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(child).toBeFocused();
  await expect(child).toHaveCSS("border-top-color", "rgb(185, 85, 65)");
  await child.fill("Camille");
  await page.locator("#pacifierPhoto").setInputFiles("public/images/tetine-transat.webp");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator('[data-step="1"] h2')).toBeFocused();
  await expect(page.locator("#review-child")).toHaveText("Pour Camille");
  await expect(page.locator("#form-error")).toBeHidden();
  await expect(page.locator('[name="firstName"], [name="lastName"], [name="email"], [name="address"], [name="postalCode"], [name="city"]')).toHaveCount(0);
  await expect(page.locator("#payment-note")).toContainText("aucune adresse n’est demandée");
  await page.screenshot({ path: `.context/order-review-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByRole("button", { name: "Terminer la démonstration" }).click();
  await expect(page.locator('[name="termsConsent"]')).toBeFocused();
  await page.locator("#previous-step").click();
  await expect(child).toHaveValue("Camille");
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.locator('[name="termsConsent"]').check();
  await page.getByRole("button", { name: "Terminer la démonstration" }).click();
  await expect(page).toHaveURL(/confirmation\?demo=1/);
});

test("checkout submits personalization only and checkout can be retried after an error", async ({ page }) => {
  await page.route("**/api/config", route => route.fulfill({ json: { mode: "test", available: true } }));
  let attempts = 0;
  const bodies: string[] = [];
  await page.route("**/api/checkout", route => {
    bodies.push(route.request().postDataBuffer()!.toString());
    attempts++;
    return route.fulfill(attempts === 1
      ? { status: 503, json: { error: "Stripe temporairement indisponible." } }
      : { json: { url: "https://checkout.stripe.com/c/pay/cs_test_fixture" } });
  });
  await page.route("https://checkout.stripe.com/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Stripe Checkout</h1>" }));
  await page.goto("/personnaliser");
  await page.getByLabel("Le prénom de votre enfant").fill("Camille");
  await page.locator("#pacifierPhoto").setInputFiles("public/images/tetine-transat.webp");
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator("#payment-note")).toContainText("adresse de livraison sur la page sécurisée Stripe");
  await page.locator('[name="termsConsent"]').check();
  await page.getByRole("button", { name: "Tester la commande avec Stripe" }).click();
  await expect(page.locator("#form-error")).toHaveText("Stripe temporairement indisponible.");
  await expect(page.locator("#review-child")).toHaveText("Pour Camille");
  await page.getByRole("button", { name: "Tester la commande avec Stripe" }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/cs_test_fixture");
  expect(attempts).toBe(2);
  for (const body of bodies) {
    expect(body).toContain('name="childName"');
    expect(body).toContain('name="pacifierPhoto"');
    for (const field of ["firstName", "lastName", "address", "postalCode", "city", "email"]) {
      expect(body).not.toContain(`name="${field}"`);
    }
  }
  const attemptId = (body: string) => /name="attemptId"\r\n\r\n([^\r]+)/.exec(body)?.[1];
  expect(attemptId(bodies[0])).toBeTruthy();
  expect(attemptId(bodies[1])).toBe(attemptId(bodies[0]));
});

test("confirmation distinguishes payment from delivery needing review", async ({ page }) => {
  await page.route("**/api/order-status", route => route.fulfill({ json: {
    status: "paid", reference: "ABCD1234", deliveryStatus: "needs_review",
  } }));
  await page.goto("/confirmation");
  await expect(page.locator("#status-title")).toHaveText("Votre paiement est confirmé.");
  await expect(page.locator("#status-copy")).toContainText("ne repassez pas commande");
  await expect(page.locator("#status-copy")).toContainText("vérification avant la préparation");
  await expect(page.locator("#follow-cards")).toBeVisible();
});
