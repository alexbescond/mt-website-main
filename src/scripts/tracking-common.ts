import { addDays, parisDate, type TrackingOrder } from "../lib/tracking-model";
import type { AdminOrder } from "../lib/tracking";
import { t, locale } from "./i18n";
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
export async function apiRequest<T>(url: string, data?: unknown): Promise<T> {
  const response = await fetch(url, data === undefined ? { cache: "no-store", headers: { "Accept-Language": locale } } : {
    method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": locale }, body: JSON.stringify(data),
  });
  const body = await response.json() as { error?: string };
  if (!response.ok) {
    const error = new Error(body.error || t("Une erreur temporaire est survenue. Réessayez."));
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body as T;
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : t("Une erreur temporaire est survenue. Réessayez.");
}
const DEMO_KEY = "mt-tracking-demo-v1";
export function demoOrder(reset = false): AdminOrder {
  if (!reset) {
    try {
      const saved = sessionStorage.getItem(DEMO_KEY);
      if (saved) {
        const value: AdminOrder = JSON.parse(saved);
        if (value.id === "demo" && value.cards.length === 3) return value;
      }
    } catch { /* Storage is optional for the demo. */ }
  }
  const today = parisDate();
  return {
    id: "demo", reference: "DEMO2026", companion: "doudou", companionName: "Lapinou", quantity: 3, deliveryMode: "weekly", locale, cardLocale: locale,
    paidAt: Date.now() - 10 * 86400000, parent: "Alex Martin", child: "Camille", email: "parent@example.com",
    address: "Alex Martin\n12 rue des Nuages\n75001 Paris\nFrance", notes: "Un petit coucou pour Camille.", hasPhoto: false, notifications: [],
    cards: [
      { position: 1, adventure: "tropiques", state: "sent", planned_date: addDays(today, -7), sent_date: addDays(today, -7), version: 1 },
      { position: 2, adventure: "ski", state: "preparing", planned_date: today, sent_date: null, version: 0 },
      { position: 3, adventure: "espace", state: "queued", planned_date: addDays(today, 7), sent_date: null, version: 0 },
    ],
  };
}
export function saveDemo(order: AdminOrder) {
  try { sessionStorage.setItem(DEMO_KEY, JSON.stringify(order)); } catch { /* No real data is stored. */ }
}
export function progressCopy(order: TrackingOrder) {
  const count = order.cards.filter(card => card.state === "sent").length;
  return { count, text: t(count > 1 ? "{0} cartes sur {1} expédiées" : "{0} carte sur {1} expédiée", count, order.quantity) };
}

export function appendChildren(parent: Node, ...children: Node[]) {
  children.forEach(child => parent.appendChild(child));
}
