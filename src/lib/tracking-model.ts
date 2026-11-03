import { adventurePreview, adventures, isAdventureId, type CompanionId, type DeliveryMode } from "./catalog";

export const cardStates = {
  queued: "À venir",
  preparing: "En préparation",
  ready: "Prête à partir",
  sent: "Expédiée",
} as const;
export type CardState = keyof typeof cardStates;
export interface TrackingCard {
  position: number;
  adventure: string;
  state: CardState;
  planned_date: string | null;
  sent_date: string | null;
  version: number;
}
export interface TrackingOrder {
  reference: string;
  companion: CompanionId;
  companionName: string;
  quantity: number;
  deliveryMode: DeliveryMode;
  paidAt: number;
  deliveryStatus?: "pending" | "ready" | "needs_review";
  cards: TrackingCard[];
}
export function parisDate(time = Date.now()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(time);
}
export function addDays(date: string, days: number) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function displayDate(date: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" })
    .format(new Date(date + "T12:00:00Z"));
}
export function cardPresentation(card: TrackingCard, companion: CompanionId) {
  if (!isAdventureId(card.adventure)) return { title: "Son aventure", image: "/images/compagnons-voyage.webp" };
  return { title: adventures[card.adventure].title, image: adventurePreview(card.adventure, companion).image };
}
export function nextDispatch(order: TrackingOrder) {
  return order.cards.find(card => card.state !== "sent");
}
