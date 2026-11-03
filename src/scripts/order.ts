import {
  adventures,
  adventurePreview,
  companions,
  isAdventureId,
  isCompanionId,
  storyTitle,
  getCardPack,
  formatPrice,
  dispatchLabel,
  type AdventureId,
  type CompanionId,
} from "../lib/catalog";
const form = document.querySelector<HTMLFormElement>("#order-form")!;
const panels = [...form.querySelectorAll<HTMLElement>("[data-step]")];
const next = document.querySelector<HTMLButtonElement>("#next-step")!;
const previous = document.querySelector<HTMLButtonElement>("#previous-step")!;
const error = document.querySelector<HTMLElement>("#form-error")!;
const modeNotice = document.querySelector<HTMLElement>("#mode-notice")!;
let step = 0;
let mode = "unavailable";
let busy = false;
function newAttemptId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Local HTTP previews lack randomUUID, but still support secure random bytes.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
let attemptId = newAttemptId();
let photoUrl: string | undefined;
let previewKey = "";
function field(name: string) {
  return form.elements.namedItem(name) as HTMLInputElement;
}
const adventureSelects = [...form.querySelectorAll("select")].filter(select => select.name === "adventure");
function selectedAdventures(): AdventureId[] {
  return adventureSelects.filter(select => !select.disabled).map((select) => isAdventureId(select.value) ? select.value : "tropiques");
}
function chosenPack() {
  const quantity = Number(new FormData(form).get("quantity"));
  return getCardPack(quantity);
}
function updatePlan() {
  const pack = chosenPack();
  form.querySelectorAll<HTMLElement>("[data-card-index]").forEach((row, index) => {
    row.hidden = index >= pack.quantity;
    row.querySelector("select")!.disabled = row.hidden;
  });
  updateAdventureOptions();
}
function updateAdventureOptions() {
  const active = adventureSelects.filter(select => !select.disabled);
  const owners = new Map<string, number>();
  // Keep every distinct choice before filling conflicts introduced by a URL
  // preselection or by restoring cards after increasing the pack size.
  active.forEach((select, index) => {
    if (isAdventureId(select.value) && !owners.has(select.value))
      owners.set(select.value, index);
  });
  active.forEach((select, index) => {
    if (owners.get(select.value) === index) return;
    const available = Object.keys(adventures).find(id => !owners.has(id));
    select.value = available ?? "";
    if (available) owners.set(available, index);
  });
  adventureSelects.forEach(select => {
    for (const option of select.options) {
      if (!isAdventureId(option.value)) continue;
      const owner = owners.get(option.value);
      const taken = owner !== undefined && active[owner] !== select;
      option.disabled = taken;
      option.textContent = adventures[option.value].short +
        (taken ? ` — déjà choisie · carte ${owner + 1}` : "");
    }
  });
}
function chosenCompanion() {
  const value = new FormData(form).get("companion");
  return isCompanionId(value) ? value : "tetine";
}
const params = new URLSearchParams(location.search);
if (isCompanionId(params.get("compagnon")))
  form.querySelector<HTMLInputElement>(
    `input[name="companion"][value="${params.get("compagnon")}"]`,
  )!.checked = true;
if (isAdventureId(params.get("aventure")))
  adventureSelects[0].value = params.get("aventure")!;
const initialQuantity = params.get("cartes");
if (initialQuantity && /^[1-5]$/.test(initialQuantity))
  form.querySelector<HTMLInputElement>(`input[name="quantity"][value="${initialQuantity}"]`)!.checked = true;
updatePlan();
if (params.get("annule") === "1")
  document.querySelector<HTMLElement>("#cancel-notice")!.hidden = false;
function summary() {
  updatePlan();
  const pack = chosenPack();
  const companion = chosenCompanion();
  const itinerary = selectedAdventures();
  const preview = adventurePreview(itinerary[0], companion);
  const image = document.querySelector<HTMLImageElement>("#summary-image")!;
  if (image.getAttribute("src") !== preview.image) image.src = preview.image;
  image.alt = preview.alt;
  document.querySelector("#summary-title")!.textContent = pack.quantity === 1
    ? storyTitle(itinerary[0], companion)
    : `${companions[companion].character} — Son voyage en ${pack.quantity} cartes`;
  updateCardPreviews(itinerary, companion);
  document.querySelector("#companion-photo-label")!.textContent =
    companion === "doudou" ? "La photo de son doudou" : "La photo de sa tétine";
  document.querySelector("#summary-caption")!.textContent =
    preview.caption;
  if (!field("pacifierPhoto").files?.length)
    field("pacifierPhoto")
      .closest(".upload-zone")!
      .querySelector(".upload-title")!.textContent =
      `Choisir une photo de ${companions[companion].character}`;
  const child = field("childName").value.trim();
  document.querySelector("#summary-child")!.textContent = child
    ? `Une histoire pour ${child}`
    : "Des nouvelles de son compagnon";
  document.querySelector("#summary-quantity")!.textContent = `${pack.quantity} ${pack.quantity === 1 ? "carte" : "cartes"} × ${formatPrice(pack.unitCents)}`;
  document.querySelector("#summary-subtotal")!.textContent = formatPrice(pack.totalCents);
  document.querySelector("#summary-total")!.textContent = formatPrice(pack.totalCents);
  document.querySelector("#summary-cadence")!.textContent = pack.quantity === 1 ? "Un envoi postal" : `${pack.quantity} envois · Une carte tous les 7 jours`;
  if (step === 1) updatePaymentLabel();
}
function updateCardPreviews(itinerary: AdventureId[], companion: CompanionId) {
  const key = `${companion}:${itinerary.join(",")}`;
  if (key === previewKey) return;
  previewKey = key;
  const multiple = itinerary.length > 1;
  document.querySelector<HTMLElement>("#summary-single")!.hidden = multiple;
  document.querySelector<HTMLElement>("#summary-bundle")!.hidden = !multiple;
  const cards = document.querySelector("#summary-cards")!;
  cards.replaceChildren(...(multiple ? itinerary.map((adventure, index) => {
    const preview = adventurePreview(adventure, companion);
    const card = document.createElement("li");
    const image = document.createElement("img");
    image.src = preview.image;
    image.alt = `Carte ${index + 1} : ${preview.alt}`;
    image.width = 600;
    image.height = 400;
    const number = document.createElement("span");
    number.className = "summary-card-number";
    number.textContent = `Carte ${index + 1}`;
    const title = document.createElement("strong");
    title.textContent = adventures[adventure].short;
    const timing = document.createElement("small");
    timing.textContent = dispatchLabel(index);
    for (const element of [image, number, title, timing]) card.appendChild(element);
    return card;
  }) : []));
  document.querySelector("#summary-bundle-caption")!.textContent =
    `Exemples illustrés avec ${companions[companion].character}. Vos cartes seront créées à partir de la photo de son compagnon.`;
}
function review() {
  const pack = chosenPack();
  const list = document.querySelector("#review-plan")!;
  list.replaceChildren(...selectedAdventures().map((id, index) => {
    const item = document.createElement("li");
    item.textContent = `Carte ${index + 1} · ${dispatchLabel(index)} · ${adventures[id].short}`;
    return item;
  }));
  document.querySelector("#review-book")!.textContent = storyTitle(
    selectedAdventures()[0],
    chosenCompanion(),
  ) + ` · ${pack.quantity} ${pack.quantity === 1 ? "carte" : "cartes"} · ${formatPrice(pack.totalCents)}`;
  document.querySelector("#review-child")!.textContent =
    `Pour ${field("childName").value.trim()}`;
  document.querySelector("#review-companion")!.textContent =
    `${companions[chosenCompanion()].label}${field("companionName").value.trim() ? ` · ${field("companionName").value.trim()}` : ""}`;
  document.querySelector("#review-notes")!.textContent = field("notes").value;
  const photos = document.querySelector("#review-photos")!;
  photos.replaceChildren();
  if (photoUrl) {
    const img = document.createElement("img");
    img.src = photoUrl;
    img.alt = "Son compagnon";
    photos.appendChild(img);
  }
}
function updatePaymentLabel() {
  const price = formatPrice(chosenPack().totalCents);
  next.textContent = mode === "demo" ? "Terminer la démonstration →" : mode === "test" ? `Tester la commande avec Stripe · ${price} →` : `Adresse et paiement · ${price} →`;
  document.querySelector("#payment-note")!.textContent = mode === "demo" ? "La démonstration s’arrête ici : aucune adresse n’est demandée et aucun paiement ni envoi postal n’est déclenché." : `Vous renseignerez votre nom, votre e-mail et votre adresse de livraison sur la page sécurisée Stripe. Paiement unique de ${price}, frais de port inclus en France métropolitaine. Aucun abonnement.`;
}
function go(index: number) {
  step = index;
  panels.forEach((panel, i) => (panel.hidden = i !== index));
  document.querySelectorAll(".order-steps li").forEach((item, i) => {
    if (i === index) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  previous.hidden = index === 0;
  error.hidden = true;
  if (index === 1) updatePaymentLabel();
  else next.textContent = "Continuer →";
  if (index === 1) review();
  panels[index]
    .querySelector<HTMLElement>("h2")!
    .focus({ preventScroll: true });
  panels[index].scrollIntoView({ behavior: "smooth", block: "start" });
}
function validatePanel(index: number) {
  panels[index].dataset.validated = "true";
  const controls = panels[index].querySelectorAll("input,textarea,select");
  for (const input of controls) {
    if (
      (input instanceof HTMLInputElement ||
        input instanceof HTMLSelectElement ||
        input instanceof HTMLTextAreaElement) &&
      !input.validity.valid
    ) {
      // Final review may uncover an invalid field in a hidden step.
      if (panels[index].hidden) go(index);
      input.reportValidity();
      return false;
    }
  }
  return true;
}
function showError(text: string) {
  error.textContent = text;
  error.hidden = false;
}
form.addEventListener("input", () => {
  summary();
  if (!busy) attemptId = newAttemptId();
});
{
  const input = field("pacifierPhoto");
  const zone = input.closest<HTMLElement>(".upload-zone")!;
  const message = document.querySelector<HTMLElement>(
    "#pacifier-error",
  )!;
  input.addEventListener("change", () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = undefined;
    const image = zone.querySelector<HTMLImageElement>(".upload-preview")!;
    image.hidden = true;
    image.removeAttribute("src");
    message.textContent = "";
    input.setCustomValidity("");
    const file = input.files?.[0];
    if (
      file &&
      (!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 5 * 1024 * 1024 ||
        file.size === 0)
    ) {
      input.value = "";
      message.textContent =
        "Choisissez une image JPG, PNG ou WebP de moins de 5 Mo.";
      input.setCustomValidity(message.textContent);
      return;
    }
    if (file) {
      photoUrl = URL.createObjectURL(file);
      image.src = photoUrl;
      image.hidden = false;
      zone.querySelector(".upload-title")!.textContent = file.name;
    } else
      zone.querySelector(".upload-title")!.textContent =
        `Choisir une photo de ${companions[chosenCompanion()].character}`;
  });
}
previous.addEventListener("click", () => go(step - 1));
document
  .querySelectorAll<HTMLButtonElement>("[data-edit]")
  .forEach((button) =>
    button.addEventListener("click", () => go(Number(button.dataset.edit))),
  );
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !validatePanel(step)) return;
  if (step < 1) {
    go(step + 1);
    return;
  }
  if (!validatePanel(0)) return;
  if (mode === "demo") {
    location.assign("/confirmation?demo=1");
    return;
  }
  if (mode !== "test" && mode !== "live") {
    showError(
      "Le paiement est temporairement indisponible. Réessayez plus tard.",
    );
    return;
  }
  busy = true;
  next.disabled = true;
  previous.disabled = true;
  const oldLabel = next.textContent;
  next.textContent = "Préparation du paiement…";
  error.hidden = true;
  try {
    const payload = new FormData(form);
    payload.set("attemptId", attemptId);
    const response = await fetch("/api/checkout", {
      method: "POST",
      body: payload,
    });
    const data = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !data.url)
      throw new Error(
        data.error ||
          "Impossible de préparer le paiement. Vos informations sont conservées sur cette page.",
      );
    const target = new URL(data.url);
    if (
      target.protocol !== "https:" ||
      target.hostname !== "checkout.stripe.com"
    )
      throw new Error("Lien de paiement invalide.");
    location.assign(target.href);
  } catch (e) {
    showError(
      e instanceof Error ? e.message : "Une erreur est survenue. Réessayez.",
    );
    busy = false;
    next.disabled = false;
    previous.disabled = false;
    next.textContent = oldLabel;
  }
});
window.addEventListener("pagehide", () => {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
});
summary();
async function initialize() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Configuration indisponible");
    const data = (await response.json()) as {
      mode: string;
      available: boolean;
    };
    mode = data.mode;
    if (mode === "demo") {
      modeNotice.textContent =
        "Version de démonstration · Aucun paiement ni envoi de photos. Vous pouvez essayer toutes les étapes.";
      next.disabled = false;
    } else if (data.available) {
      modeNotice.textContent =
        mode === "test"
          ? "Mode test Stripe · Utilisez des données fictives et une carte de test. Aucun débit réel."
          : "Vos cartes seront créées à partir des informations ci-dessous.";
      document.querySelector("#payment-note")!.textContent =
        mode === "test"
          ? "Vous serez redirigé vers Stripe en mode test. Aucune somme ne sera débitée."
          : `Vous serez redirigé vers Stripe pour régler ${formatPrice(chosenPack().totalCents)}. Vos informations bancaires ne transitent pas par notre site.`;
      next.disabled = false;
    } else {
      modeNotice.textContent =
        "Les commandes ne sont pas encore ouvertes. Revenez bientôt pour préparer le voyage de son compagnon.";
    }
  } catch {
    modeNotice.textContent =
      "Le formulaire est momentanément indisponible. Rechargez la page pour réessayer.";
  }
}
void initialize();
