export const SITE_NAME = "Les aventures de mon doudou et ma tétine";
export const SEND_INTERVAL_DAYS = 7;
// Adjust this single value to change the grouped-delivery discount everywhere.
export const TOGETHER_DISCOUNT_CENTS = 75;
export type DeliveryMode = "weekly" | "together";
export function isDeliveryMode(value: unknown): value is DeliveryMode {
  return value === "weekly" || value === "together";
}
export function deliveryLabel(quantity: number, mode: DeliveryMode) {
  if (quantity === 1) return "Un envoi postal";
  return mode === "together" ? "Toutes les cartes dans un seul envoi" : `${quantity} envois · Une carte tous les 7 jours`;
}
export const cardPacks = [
  { quantity: 1, unitCents: 700, totalCents: 700, name: "Un petit coucou" },
  { quantity: 2, unitCents: 600, totalCents: 1200, name: "Deux découvertes" },
  { quantity: 3, unitCents: 550, totalCents: 1650, name: "Le petit voyage" },
  { quantity: 4, unitCents: 525, totalCents: 2100, name: "La grande escapade" },
  { quantity: 5, unitCents: 500, totalCents: 2500, name: "Le plein d’aventures" },
] as const;
export function getCardPack(quantity: number) {
  const pack = cardPacks.find((pack) => pack.quantity === quantity);
  if (!pack) throw new RangeError("Choisissez de 1 à 5 cartes.");
  return pack;
}
export function getOrderPrice(quantity: number, deliveryMode: DeliveryMode = "weekly") {
  const pack = getCardPack(quantity);
  const discountCents = deliveryMode === "together" && quantity > 1 ? TOGETHER_DISCOUNT_CENTS * quantity : 0;
  return { ...pack, baseTotalCents: pack.totalCents, discountCents,
    unitCents: pack.unitCents - discountCents / quantity, totalCents: pack.totalCents - discountCents };
}
export function formatPrice(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(cents / 100);
}
export const companions = {
  tetine: {
    label: "Ma tétine",
    character: "Tétine",
    description: "Pour accompagner un petit au revoir, à son rythme.",
  },
  doudou: {
    label: "Mon doudou",
    character: "Doudou",
    description: "Pour faire voyager son compagnon de tous les jours.",
  },
} as const;
export type CompanionId = keyof typeof companions;
export function isCompanionId(value: unknown): value is CompanionId {
  return value === "tetine" || value === "doudou";
}
export const adventures = {
  tropiques: {
    title: "Sous les cocotiers",
    short: "Sous les cocotiers",
    subtitle: "Le soleil, le sable et les copains",
    eyebrow: "CAP SUR LE SOLEIL",
    description:
      "Un premier vol, un lagon turquoise et des châteaux de sable. Les journées sont pleines de petites découvertes et de grandes pensées pour votre enfant.",
    image: "/images/tetine-transat.webp",
    color: "tropical",
    icon: "sun",
    destination: "L’île aux mille couleurs",
  },
  ski: {
    title: "La tête dans les flocons",
    short: "Au ski",
    subtitle: "La neige, les rires et le chocolat chaud",
    eyebrow: "L’APPEL DES SOMMETS",
    description:
      "Un bonnet bien enfoncé, des premières glissades et des joues toutes roses. Une escapade enneigée qui se termine bien au chaud, entre amis.",
    image: "/images/tetine-ski.webp",
    color: "winter",
    icon: "snow",
    destination: "Les montagnes enchantées",
  },
  safari: { title: "Un safari dans la savane", short: "Au safari", image: "/images/tetine-safari.webp", description: "Un copain, des jumelles et des lions sur les rochers… sans oublier la girafe dans le rétroviseur !", icon: "sun" },
  plongee: { title: "À la rencontre des poissons", short: "Fait de la plongée", image: "/images/tetine-plongee.webp", description: "Un masque, des palmes et un monde de couleurs sous l’eau.", icon: "sparkles" },
  avion: { title: "Un coucou depuis les nuages", short: "Prend l’avion", image: "/images/tetine-avion.webp", description: "Un hublot, des nuages et l’impatience de découvrir le monde.", icon: "plane" },
  aeroport: { title: "Prêt pour l’embarquement", short: "Embarque à l’aéroport", image: "/images/tetine-enregistrement.webp", description: "Une petite valise, un billet et le début d’une grande aventure.", icon: "plane" },
  bateau: { title: "Cap sur le grand bleu", short: "Fait du bateau", image: "/images/tetine-bateau.webp", description: "Un bateau pirate, de grandes voiles et des îles à explorer, le sourire au vent.", icon: "plane" },
  pelleteuse: { title: "Le petit chantier des grands rêves", short: "Conduit une pelleteuse", image: "/images/tetine-pelleteuse.webp", description: "Un casque et une pelleteuse pour bâtir un monde imaginaire.", icon: "box" },
  circuit: { title: "En piste pour l’aventure", short: "Pilote une voiture de course sur circuit", image: "/images/tetine-circuit.webp", description: "Une monoplace colorée, un casque et un circuit imaginaire pour faire le plein de sensations.", icon: "sparkles" },
  espace: { title: "Des nouvelles des étoiles", short: "Explore l’espace", image: "/images/tetine-espace.webp", description: "Une fusée, des étoiles et une pensée venue de très loin.", icon: "sparkles" },
  noel: { title: "Un coup de patte au Père Noël", short: "Aide le Père Noël", image: "/images/tetine-noel.webp", description: "Des cadeaux à emballer, des rubans dorés et la magie d’un après-midi dans l’atelier du Père Noël.", icon: "sparkles" },
} as const;
export type AdventureId = keyof typeof adventures;
const doudouImages: Record<AdventureId, string> = {
  tropiques: "/images/doudou-transat.webp",
  ski: "/images/doudou-ski.webp",
  plongee: "/images/doudou-plongee.webp",
  avion: "/images/doudou-avion.webp",
  aeroport: "/images/doudou-enregistrement.webp",
  safari: "/images/doudou-safari.webp",
  bateau: "/images/doudou-bateau.webp",
  pelleteuse: "/images/doudou-pelleteuse.webp",
  circuit: "/images/doudou-circuit.webp",
  espace: "/images/doudou-espace.webp",
  noel: "/images/doudou-noel.webp",
};
export function adventurePreview(adventure: AdventureId, companion: CompanionId) {
  const scene = adventures[adventure];
  const character = companions[companion].character;
  return {
    image: companion === "doudou"
      ? doudouImages[adventure]
      : scene.image,
    alt: `Exemple de carte avec ${character} — ${scene.title}`,
    caption: `EXEMPLE ILLUSTRÉ AVEC ${character.toLocaleUpperCase("fr-FR")}`,
  };
}
export function isAdventureId(value: unknown): value is AdventureId {
  return typeof value === "string" && Object.hasOwn(adventures, value);
}
export function storyTitle(adventure: AdventureId, companion: CompanionId) {
  return `${companions[companion].character} — ${adventures[adventure].title}`;
}
export function dispatchLabel(index: number, mode: DeliveryMode = "weekly") {
  if (mode === "together") return "Envoi groupé";
  return index === 0 ? "Premier envoi" : `+ ${index * SEND_INTERVAL_DAYS} jours`;
}
