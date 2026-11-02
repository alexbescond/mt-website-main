import {
  books,
  companions,
  isBookId,
  isCompanionId,
  storyTitle,
  PRICE_LABEL,
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
const objectUrls = new Map<string, string>();
function field(name: string) {
  return form.elements.namedItem(name) as HTMLInputElement;
}
function chosenBook() {
  const value = new FormData(form).get("book");
  return isBookId(value) ? value : "tropiques";
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
if (isBookId(params.get("aventure")))
  form.querySelector<HTMLInputElement>(
    `input[value="${params.get("aventure")}"]`,
  )!.checked = true;
if (params.get("annule") === "1")
  document.querySelector<HTMLElement>("#cancel-notice")!.hidden = false;
function summary() {
  const book = books[chosenBook()];
  document.querySelector<HTMLImageElement>("#summary-image")!.src = book.image;
  const companion = chosenCompanion();
  document.querySelector("#summary-title")!.textContent = storyTitle(
    chosenBook(),
    companion,
  );
  document.querySelector("#companion-photo-label")!.textContent =
    companion === "doudou" ? "La photo de son doudou" : "La photo de sa tétine";
  document.querySelector("#summary-caption")!.textContent =
    companion === "doudou"
      ? "DÉCOR ILLUSTRATIF · VOTRE DOUDOU SERA LE HÉROS"
      : "EXEMPLE ILLUSTRÉ AVEC TÉTINE";
  if (!field("pacifierPhoto").files?.length)
    field("pacifierPhoto")
      .closest(".upload-zone")!
      .querySelector(".upload-title")!.textContent =
      `Choisir une photo de ${companions[companion].character}`;
  const child = field("childName").value.trim();
  document.querySelector("#summary-child")!.textContent = child
    ? `Une histoire pour ${child}`
    : "L’histoire de son compagnon";
}
function review() {
  document.querySelector("#review-book")!.textContent = storyTitle(
    chosenBook(),
    chosenCompanion(),
  );
  document.querySelector("#review-child")!.textContent =
    `Pour ${field("childName").value.trim()}`;
  document.querySelector("#review-companion")!.textContent =
    `${companions[chosenCompanion()].label}${field("companionName").value.trim() ? ` · ${field("companionName").value.trim()}` : ""}`;
  document.querySelector("#review-notes")!.textContent = field("notes").value;
  document.querySelector("#review-address")!.textContent =
    `${field("firstName").value} ${field("lastName").value}\n${field("address").value}\n${field("addressExtra").value ? field("addressExtra").value + "\n" : ""}${field("postalCode").value} ${field("city").value}\nFrance métropolitaine`;
  document.querySelector("#review-email")!.textContent = field("email").value;
  const photos = document.querySelector("#review-photos")!;
  photos.replaceChildren();
  for (const [name, url] of objectUrls) {
    const img = document.createElement("img");
    img.src = url;
    img.alt =
      name === "pacifierPhoto" ? "Son compagnon" : "Portrait de votre enfant";
    photos.appendChild(img);
  }
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
  next.textContent =
    index === 2
      ? mode === "demo"
        ? "Terminer la démonstration →"
        : mode === "test"
          ? "Tester le paiement Stripe →"
          : `Payer ${PRICE_LABEL} avec Stripe →`
      : "Continuer →";
  if (index === 2) review();
  panels[index]
    .querySelector<HTMLElement>("h2")!
    .focus({ preventScroll: true });
  panels[index].scrollIntoView({ behavior: "smooth", block: "start" });
}
function validatePanel(index: number) {
  const controls = panels[index].querySelectorAll("input,textarea,select");
  for (const input of controls) {
    if (
      (input instanceof HTMLInputElement ||
        input instanceof HTMLSelectElement ||
        input instanceof HTMLTextAreaElement) &&
      !input.reportValidity()
    )
      return false;
  }
  if (index === 1 && /^(97|98)/.test(field("postalCode").value)) {
    showError(
      "La livraison est actuellement proposée en France métropolitaine uniquement.",
    );
    field("postalCode").focus();
    return false;
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
for (const name of ["pacifierPhoto", "childPhoto"]) {
  const input = field(name);
  const zone = input.closest<HTMLElement>(".upload-zone")!;
  const message = document.querySelector<HTMLElement>(
    name === "pacifierPhoto" ? "#pacifier-error" : "#child-error",
  )!;
  input.addEventListener("change", () => {
    if (objectUrls.has(name)) URL.revokeObjectURL(objectUrls.get(name)!);
    objectUrls.delete(name);
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
      const url = URL.createObjectURL(file);
      objectUrls.set(name, url);
      image.src = url;
      image.hidden = false;
      zone.querySelector(".upload-title")!.textContent = file.name;
    } else
      zone.querySelector(".upload-title")!.textContent =
        name === "pacifierPhoto"
          ? `Choisir une photo de ${companions[chosenCompanion()].character}`
          : "Ajouter son portrait";
    document.querySelector<HTMLButtonElement>("#remove-child")!.hidden =
      !field("childPhoto").files?.length;
  });
}
document.querySelector("#remove-child")!.addEventListener("click", () => {
  field("childPhoto").value = "";
  field("childPhoto").dispatchEvent(new Event("change"));
});
previous.addEventListener("click", () => go(step - 1));
document
  .querySelectorAll<HTMLButtonElement>("[data-edit]")
  .forEach((button) =>
    button.addEventListener("click", () => go(Number(button.dataset.edit))),
  );
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !validatePanel(step)) return;
  if (step < 2) {
    go(step + 1);
    return;
  }
  for (let i = 0; i < 2; i++) {
    if (!validatePanel(i)) {
      go(i);
      return;
    }
  }
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
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
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
          : "Votre livre sera créé à partir des informations ci-dessous.";
      document.querySelector("#payment-note")!.textContent =
        mode === "test"
          ? "Vous serez redirigé vers Stripe en mode test. Aucune somme ne sera débitée."
          : `Vous serez redirigé vers Stripe pour régler ${PRICE_LABEL}. Vos informations bancaires ne transitent pas par notre site.`;
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
