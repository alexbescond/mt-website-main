import { cardPresentation, cardStates, displayDate, nextDispatch, parisDate, type TrackingOrder } from "../lib/tracking-model";
import { appendChildren, apiRequest, demoOrder, element, errorText, progressCopy } from "./tracking-common";

const content = document.querySelector<HTMLElement>("#tracking-content")!;
const access = document.querySelector<HTMLElement>("#tracking-access")!;
const message = document.querySelector<HTMLElement>("#tracking-message")!;
const refresh = document.querySelector<HTMLButtonElement>("#refresh-tracking")!;
let demo = false;
function render(order: TrackingOrder) {
  const progress = progressCopy(order);
  document.querySelector("#tracking-companion")!.textContent = order.companionName || (order.companion === "doudou" ? "Son doudou" : "Sa tétine");
  document.querySelector("#tracking-reference")!.textContent = "Commande " + order.reference + " · Paiement confirmé";
  document.querySelector("#tracking-progress")!.textContent = progress.text;
  document.querySelector("#tracking-progress-percent")!.textContent = Math.round(progress.count / order.quantity * 100) + " %";
  const bar = document.querySelector<HTMLProgressElement>("#tracking-progress-bar")!;
  bar.max = order.quantity; bar.value = progress.count;
  const next = nextDispatch(order);
  const late = next?.planned_date && next.planned_date < parisDate();
  document.querySelector("#tracking-next-date")!.textContent = !next ? "Toutes ses cartes ont pris la route" :
    late ? "Une nouvelle date arrive" : next.planned_date ? displayDate(next.planned_date) : "Le premier départ se prépare";
  document.querySelector("#tracking-next-copy")!.textContent = !next ? "L’aventure continue dans votre boîte aux lettres." :
    late ? "Cette carte attend encore son départ. Son expédition sera confirmée ici." :
    next.planned_date ? "Carte " + next.position + " · Date d’expédition prévue." : "La date sera indiquée ici dès que le planning sera confirmé.";
  const list = document.querySelector("#tracking-cards")!;
  list.replaceChildren();
  order.cards.forEach(card => {
    const scene = cardPresentation(card, order.companion);
    const item = element("li", "tracking-card"); item.dataset.state = card.state;
    appendChildren(item, element("span", "tracking-marker", card.state === "sent" ? "✓" : String(card.position)));
    const body = element("div", "tracking-card-body");
    const image = element("img"); image.src = scene.image; image.alt = "Illustration de l’aventure : " + scene.title;
    image.width = 120; image.height = 140;
    const copy = element("div", "tracking-card-copy");
    const badge = element("span", "tracking-badge", cardStates[card.state]); badge.dataset.state = card.state;
    const overdue = card.state !== "sent" && card.planned_date && card.planned_date < parisDate();
    const date = card.sent_date ? "Expédiée le " + displayDate(card.sent_date) :
      card.planned_date ? (overdue ? "Départ à reprogrammer · prévu le " : "Départ prévu le ") + displayDate(card.planned_date) : "Date de départ à confirmer";
    appendChildren(copy, element("span", "eyebrow", "CARTE " + String(card.position).padStart(2, "0")), element("h3", "", scene.title), badge, element("p", "tracking-card-date" + (overdue ? " overdue" : ""), date));
    appendChildren(body, image, copy); appendChildren(item, body); appendChildren(list, item);
  });
  message.textContent = ""; access.hidden = true; content.hidden = false;
}
async function load() {
  refresh.disabled = true;
  try { render(demo ? demoOrder() : await apiRequest<TrackingOrder>("/api/tracking")); }
  catch (error) { content.hidden = true; access.hidden = false; message.textContent = errorText(error); }
  finally { refresh.disabled = false; }
}
async function start() {
  // Remove the credential from the address bar before any asynchronous request.
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("acces");
  if (token) history.replaceState(null, "", location.pathname + location.search);
  try {
    const config = await apiRequest<{ mode: string }>("/api/config");
    const available = config.mode === "demo";
    document.querySelector<HTMLElement>("#tracking-demo-link")!.hidden = !available;
    demo = available && new URLSearchParams(location.search).get("demo") === "1";
    document.querySelector<HTMLElement>("#demo-banner")!.hidden = !demo;
    if (token && !demo) await apiRequest("/api/tracking/access", { token });
    if (!token && !demo && new URLSearchParams(location.search).get("confirmation") === "1") {
      await apiRequest("/api/tracking/checkout", {});
      history.replaceState(null, "", location.pathname);
    }
    await load();
  } catch (error) { access.hidden = false; message.textContent = errorText(error); }
}
refresh.addEventListener("click", () => { void load(); });
document.querySelector<HTMLFormElement>("#tracking-access-form")!.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector("button")!;
  button.disabled = true;
  const data = new FormData(form);
  const output = document.querySelector("#access-message")!;
  try {
    const result = await apiRequest<{ message: string }>("/api/tracking/email", { email: data.get("email"), reference: data.get("reference") });
    output.textContent = result.message;
  } catch (error) { output.textContent = errorText(error); }
  finally { button.disabled = false; }
});
void start();
