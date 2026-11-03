import { addDays, cardPresentation, cardStates, displayDate, parisDate, type TrackingCard } from "../lib/tracking-model";
import type { AdminOrder } from "../lib/tracking";
import { appendChildren, apiRequest, demoOrder, element, errorText, progressCopy, saveDemo } from "./tracking-common";

const content = document.querySelector<HTMLElement>("#admin-content")!;
const login = document.querySelector<HTMLElement>("#admin-login-panel")!;
const message = document.querySelector<HTMLElement>("#admin-message")!;
const dialog = document.querySelector<HTMLDialogElement>("#dispatch-dialog")!;
let demo = false, page = 0, filter = "active";
let selected: { order: AdminOrder; card: TrackingCard } | undefined;
async function mutate(order: AdminOrder, card: TrackingCard, state: TrackingCard["state"], sentDate?: string) {
  if (demo) {
    const current = demoOrder();
    const target = current.cards.find(item => item.position === card.position)!;
    if (state === "sent" && current.cards.some(item => item.position < card.position && item.state !== "sent"))
      throw new Error("Expédiez d’abord les cartes précédentes.");
    target.state = state; target.version++;
    if (sentDate) {
      target.sent_date = sentDate;
      current.cards.filter(item => item.position > card.position).forEach(item => { item.planned_date = addDays(sentDate, (item.position - card.position) * 7); item.version++; });
    }
    saveDemo(current);
  } else await apiRequest("/api/admin/orders/" + order.id + "/cards/" + card.position, { state, version: card.version, sentDate });
}
function renderOrder(order: AdminOrder) {
  const article = element("article", "admin-order");
  const header = element("div", "admin-order-header");
  const title = element("div");
  appendChildren(title, element("span", "eyebrow", "COMMANDE " + order.reference), element("h2", "", order.companionName || "Son compagnon"), element("p", "", order.parent + " · Pour " + order.child));
  appendChildren(header, title, element("span", "tracking-badge", progressCopy(order).text)); appendChildren(article, header);
  const deliveryBlocked = order.deliveryStatus && order.deliveryStatus !== "ready";
  if (deliveryBlocked) appendChildren(article, element("p", "notice", "Coordonnées de livraison à vérifier dans Stripe : adresse incomplète ou hors France métropolitaine. Préparation et expédition bloquées. Contacter le client avant de poursuivre ou de rembourser."));
  const details = element("details");
  appendChildren(details, element("summary", "", "Coordonnées, photo et personnalisation"));
  const customer = element("div", "admin-customer");
  const address = element("div"); appendChildren(address, element("p", "", order.address), element("p", "", order.email));
  const personal = element("div"); appendChildren(personal, element("p", "", "Pour " + order.child + " · " + (order.companionName || order.companion)), element("p", "", order.notes || "Aucune précision supplémentaire."));
  if (order.hasPhoto && !demo) {
    const photo = element("a", "tracking-text-button", "Ouvrir la photo du compagnon");
    photo.href = "/api/admin/orders/" + order.id + "/photo"; photo.target = "_blank"; photo.rel = "noopener"; appendChildren(personal, photo);
  } else appendChildren(personal, element("p", "", demo ? "Photo fictive pour cet exemple." : "Photo indisponible ou supprimée selon la durée de conservation."));
  appendChildren(customer, address, personal); appendChildren(details, customer); appendChildren(article, details);
  const first = order.cards[0];
  if (first && first.state !== "sent" && !deliveryBlocked) {
    const schedule = element("form", "admin-schedule");
    const label = element("label", "", "Premier envoi prévu");
    const input = element("input"); input.type = "date"; input.required = true; input.min = parisDate(); input.value = first.planned_date || "";
    appendChildren(label, input);
    const button = element("button", "button button-small", "Planifier les départs"); button.type = "submit";
    appendChildren(schedule, label, button);
    schedule.addEventListener("submit", async event => {
      event.preventDefault(); button.disabled = true;
      try {
        if (demo) {
          const current = demoOrder();
          current.cards.forEach(card => { card.planned_date = addDays(input.value, (card.position - 1) * 7); card.version++; });
          saveDemo(current);
        } else await apiRequest("/api/admin/orders/" + order.id + "/schedule", { date: input.value, version: first.version });
        await load(); message.textContent = "Le planning est à jour.";
      } catch (error) { message.textContent = errorText(error); } finally { button.disabled = false; }
    }); appendChildren(article, schedule);
  }
  order.cards.forEach(card => {
    const row = element("div", "admin-card");
    const scene = cardPresentation(card, order.companion);
    const image = element("img"); image.src = scene.image; image.alt = ""; image.width = 44; image.height = 55;
    const copy = element("div"); const badge = element("span", "tracking-badge", cardStates[card.state]); badge.dataset.state = card.state;
    appendChildren(copy, element("h3", "", "Carte " + card.position + " · " + scene.title), badge,
      element("p", "", card.sent_date ? "Expédiée le " + displayDate(card.sent_date) : card.planned_date ? "Départ prévu le " + displayDate(card.planned_date) : "Date à planifier"));
    appendChildren(row, image, copy);
    if (card.state !== "sent" && !deliveryBlocked) {
      const next = card.state === "queued" ? "preparing" : card.state === "preparing" ? "ready" : "sent";
      const button = element("button", "button button-small", next === "preparing" ? "Commencer la préparation" : next === "ready" ? "Marquer comme prête" : "Marquer comme expédiée");
      button.type = "button";
      button.addEventListener("click", async () => {
        if (next === "sent") {
          selected = { order, card };
          document.querySelector("#dispatch-card-title")!.textContent = "Commande " + order.reference + " · Carte " + card.position + " · " + scene.title;
          const date = document.querySelector<HTMLInputElement>("#dispatch-date")!;
          date.max = parisDate(); date.value = parisDate();
          date.min = order.cards[card.position - 2]?.sent_date || parisDate(order.paidAt);
          document.querySelector("#dispatch-error")!.textContent = "";
          dialog.showModal(); return;
        }
        button.disabled = true;
        try { await mutate(order, card, next); await load(); message.textContent = "L’avancement de la carte est à jour."; }
        catch (error) { message.textContent = errorText(error); } finally { button.disabled = false; }
      }); appendChildren(row, button);
    }
    appendChildren(article, row);
  });
  const failed = order.notifications.filter(item => item.status === "failed").length;
  const waiting = order.notifications.filter(item => item.status === "pending" || item.status === "sending").length;
  if (failed && !demo) {
    const retry = element("button", "tracking-text-button", "Réessayer les notifications en échec");
    retry.type = "button";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      try { await apiRequest("/api/admin/orders/" + order.id + "/notifications/retry", {}); await load(); }
      catch (error) { message.textContent = errorText(error); }
      finally { retry.disabled = false; }
    });
    appendChildren(article, retry);
  }
  appendChildren(article, element("p", "admin-notifications", failed ? failed + " notification(s) en échec — vérifier l’envoi des e-mails." : waiting ? waiting + " notification(s) en attente d’envoi." : "Le suivi client reflète les dernières mises à jour."));
  return article;
}
async function load() {
  message.textContent = "";
  try {
    const search = document.querySelector<HTMLInputElement>("#search-orders")!.value;
    const data = demo ? { orders: [demoOrder()], hasMore: false, emailEnabled: false } :
      await apiRequest<{ orders: AdminOrder[]; hasMore: boolean; emailEnabled: boolean }>("/api/admin/orders?" + new URLSearchParams({ page: String(page), search, filter }));
    let orders = data.orders;
    if (demo) orders = orders.filter(order => {
      const active = order.cards.some(card => card.state !== "sent");
      return (filter === "all" || (filter === "sent" ? !active : filter === "due" ? order.cards.some(card => card.state !== "sent" && (!card.planned_date || card.planned_date <= parisDate())) : active)) &&
        (order.reference + order.parent + order.email).toLowerCase().includes(search.toLowerCase());
    });
    const list = document.querySelector("#admin-orders")!; list.replaceChildren(...orders.map(renderOrder));
    if (!orders.length) appendChildren(list, element("p", "", "Aucune commande dans cette vue. Les commandes payées apparaîtront ici."));
    document.querySelector<HTMLElement>("#admin-email-note")!.hidden = data.emailEnabled || demo;
    document.querySelector<HTMLButtonElement>("#admin-prev")!.disabled = page === 0;
    document.querySelector<HTMLButtonElement>("#admin-next")!.disabled = !data.hasMore;
    document.querySelector("#admin-page-number")!.textContent = "Page " + (page + 1);
    login.hidden = true; content.hidden = false;
  } catch (error) {
    message.textContent = errorText(error);
    if (error instanceof Error && "status" in error && (error.status === 401 || error.status === 503)) { content.hidden = true; login.hidden = false; }
  }
}
document.querySelector<HTMLFormElement>("#admin-login")!.addEventListener("submit", async event => {
  event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const button = form.querySelector("button")!; button.disabled = true;
  try { await apiRequest("/api/admin/login", { password: new FormData(form).get("password") }); form.reset(); await load(); }
  catch (error) { message.textContent = errorText(error); } finally { button.disabled = false; }
});
document.querySelector("#admin-logout")!.addEventListener("click", async () => {
  try { if (!demo) await apiRequest("/api/admin/logout", {}); content.hidden = true; login.hidden = false; }
  catch (error) { message.textContent = errorText(error); }
});
document.querySelector("#admin-search")!.addEventListener("submit", event => { event.preventDefault(); page = 0; void load(); });
document.querySelector("#admin-refresh")!.addEventListener("click", () => { void load(); });
document.querySelector("#admin-prev")!.addEventListener("click", () => { page = Math.max(0, page - 1); void load(); });
document.querySelector("#admin-next")!.addEventListener("click", () => { page++; void load(); });
document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(button => button.addEventListener("click", () => {
  filter = button.dataset.filter!; page = 0;
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
  void load();
}));
document.querySelector("#reset-demo")!.addEventListener("click", () => { saveDemo(demoOrder(true)); void load(); });
document.querySelector("#cancel-dispatch")!.addEventListener("click", () => dialog.close());
document.querySelector<HTMLFormElement>("#dispatch-form")!.addEventListener("submit", async event => {
  event.preventDefault(); if (!selected) return;
  const button = (event.currentTarget as HTMLFormElement).querySelector<HTMLButtonElement>('button[type="submit"]')!; button.disabled = true;
  try {
    await mutate(selected.order, selected.card, "sent", document.querySelector<HTMLInputElement>("#dispatch-date")!.value);
    dialog.close(); await load(); message.textContent = demo ? "Expédition simulée. Retrouvez-la dans le suivi client." : "Expédition enregistrée. La notification est en attente d’envoi.";
  } catch (error) { document.querySelector("#dispatch-error")!.textContent = errorText(error); }
  finally { button.disabled = false; }
});
async function start() {
  try {
    const config = await apiRequest<{ mode: string }>("/api/config");
    document.querySelector<HTMLElement>("#admin-demo-link")!.hidden = config.mode !== "demo";
    demo = config.mode === "demo" && new URLSearchParams(location.search).get("demo") === "1";
    document.querySelector<HTMLElement>("#demo-banner")!.hidden = !demo;
    if (demo) saveDemo(demoOrder());
    await load();
  } catch (error) { message.textContent = errorText(error); login.hidden = false; }
}
void start();
