export const SITE_NAME = "Les aventures de mon doudou et ma tétine";
export const PRICE_CENTS = 2990;
export const PRICE_LABEL = "29,90 €";
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
export const books = {
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
} as const;
export type BookId = keyof typeof books;
export function isBookId(value: unknown): value is BookId {
  return value === "tropiques" || value === "ski";
}
export function storyTitle(book: BookId, companion: CompanionId) {
  return `${companions[companion].character} — ${books[book].title}`;
}
