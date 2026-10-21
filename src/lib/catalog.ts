export const SITE_NAME = "Les vacances de ma tétine";
export const PRICE_CENTS = 2990;
export const PRICE_LABEL = "29,90 €";
export const books = {
  tropiques: {
    title: "Tétine va sous les tropiques",
    short: "Sous les tropiques",
    eyebrow: "DU SOLEIL ET DES SOUVENIRS",
    description:
      "Un billet pour le paradis, des châteaux de sable et de nouveaux amis. Tétine a tant de choses à raconter !",
    image: "/images/tetine-transat.webp",
    color: "tropical",
  },
  ski: {
    title: "Tétine va au ski",
    short: "À la montagne",
    eyebrow: "DES FLOCONS ET DES FRISSONS",
    description:
      "Premières glissades, sommets enneigés et chocolat chaud. Une aventure toute douce au grand air.",
    image: "/images/tetine-ski.webp",
    color: "winter",
  },
} as const;
export type BookId = keyof typeof books;
export function isBookId(value: unknown): value is BookId {
  return value === "tropiques" || value === "ski";
}
