import type { AdventureId } from "./catalog";

// Imaginary postal services and engraved motifs for each adventure.
export const postage = {
  ski: {
    office: "La poste du mont Doudou", lines: ["LA POSTE DU", "MONT DOUDOU"], caption: "NEIGES ÉTERNELLES", motif: "un flocon",
    ink: "#496b80", paper: "#e2e8e3",
    drawing: "M32 3V61 M7 18L57 46 M7 46L57 18 M24 9L32 17L40 9 M24 55L32 47L40 55 M8 27L20 25L18 13 M46 51L44 39L56 37 M8 37L20 39L18 51 M46 13L44 25L56 27 M32 23L40 28V36L32 41L24 36V28Z",
  },
  tropiques: {
    office: "The beach post", lines: ["THE BEACH", "POST"], caption: "BONS BAISERS DES ÎLES", motif: "un cocotier",
    ink: "#5a7255", paper: "#e7e8cf",
    drawing: "M27 55Q35 38 31 22 M32 55Q40 36 34 22 M32 22Q16 8 5 23Q19 17 32 22 M32 22Q22 0 12 8Q27 9 32 22 M33 22Q36 2 50 7Q40 12 33 22 M33 22Q51 8 60 25Q45 17 33 22 M33 22Q48 22 49 37Q42 26 33 22 M6 57Q19 50 32 55Q43 51 59 57 M8 61H56 M12 38H19 M15.5 34.5V41.5",
  },
  noel: {
    office: "Le service des lutins", lines: ["LE SERVICE", "DES LUTINS"], caption: "ATELIER DU PÈRE NOËL", motif: "un cadeau enrubanné",
    ink: "#984f45", paper: "#f1e1cf",
    drawing: "M10 29H54V57H10Z M7 22H57V30H7Z M28 22V57 M36 22V57 M32 22C6 22 12 0 24 8Q32 13 32 22 M32 22C58 22 52 0 40 8Q32 13 32 22 M8 9V15 M5 12H11 M55 6V14 M51 10H59 M14 38H23 M41 47H49",
  },
  safari: {
    office: "La poste de la savane", lines: ["LA POSTE DE", "LA SAVANE"], caption: "TERRES LOINTAINES", motif: "un acacia",
    ink: "#8b6939", paper: "#eee2bf",
    drawing: "M27 56L30 30L19 22 M35 56L33 31L45 21 M30 38L12 26 M33 38L52 25 M4 24Q0 16 11 15Q9 7 23 9Q31 0 40 10Q54 5 55 15Q66 17 60 25Z M8 57Q29 52 56 57 M12 61H52",
  },
  plongee: {
    office: "Le courrier des coraux", lines: ["LE COURRIER", "DES CORAUX"], caption: "VINGT MILLE BISOUS", motif: "un poisson et des coraux",
    ink: "#497d7b", paper: "#dce8de",
    drawing: "M10 29Q28 8 46 28L59 17V41L46 30Q29 49 10 29Z M29 17Q22 30 30 41 M18 27H19 M6 59L12 46V38 M12 50L4 45 M12 53L21 46 M46 59V47L39 41 M46 53L55 43 M22 8A3 3 0 1 0 28 8A3 3 0 1 0 22 8 M37 3A2 2 0 1 0 41 3A2 2 0 1 0 37 3",
  },
  avion: {
    office: "L’aéropostale des nuages", lines: ["L’AÉROPOSTALE", "DES NUAGES"], caption: "PAR AVION · PAR AMOUR", motif: "un avion à hélice",
    ink: "#576e83", paper: "#e2e5e6",
    drawing: "M8 34L53 24L58 29L14 43Z M30 29L22 9L28 7L43 27 M29 39L31 55L37 53L40 36 M14 33L7 23L3 25L8 36 M56 20L61 35 M2 51H18 M6 56H15 M44 9H60 M49 14H57",
  },
  aeroport: {
    office: "Le bureau des départs", lines: ["LE BUREAU", "DES DÉPARTS"], caption: "BON POUR L’AVENTURE", motif: "une valise de voyage",
    ink: "#906b46", paper: "#eee2ce",
    drawing: "M8 20H56V54H8Z M24 20V12H40V20 M18 20V54 M46 20V54 M8 29H18 M8 45H18 M46 29H56 M46 45H56 M27 32L38 28L42 39L31 43Z M30 34L35 37L38 33 M14 58H20 M44 58H50",
  },
  bateau: {
    office: "La poste du grand large", lines: ["LA POSTE DU", "GRAND LARGE"], caption: "COURRIER DES OCÉANS", motif: "un voilier",
    ink: "#4b7185", paper: "#dee7e4",
    drawing: "M32 4V44 M27 11L10 37H27Z M37 7L54 37H37Z M7 44H58L49 54H17Z M4 59Q11 53 18 59Q25 65 32 59Q39 53 46 59Q53 65 60 59 M35 4H47L40 10",
  },
  pelleteuse: {
    office: "La poste des bâtisseurs", lines: ["LA POSTE DES", "BÂTISSEURS"], caption: "LES GRANDS PETITS RÊVES", motif: "une pelleteuse",
    ink: "#9c7435", paper: "#efe4c4",
    drawing: "M8 45H34A7 7 0 0 1 34 59H8A7 7 0 0 1 8 45Z M8 52H34 M9 45V28H25L31 45 M13 32H22L26 40H13Z M28 36L38 14L45 14L56 39 M33 39L41 22L51 41 M49 41H61L57 49H46Z M4 63H60",
  },
  circuit: {
    office: "Le relais des champions", lines: ["LE RELAIS", "DES CHAMPIONS"], caption: "À TOUTE ALLURE", motif: "des drapeaux de course",
    ink: "#8d594c", paper: "#eee0cc",
    drawing: "M10 58L27 8 M54 58L37 8 M25 13L5 7L0 26L19 32 M39 13L59 7L64 26L45 32 M15 10L10 29 M23 22L3 16 M49 10L54 29 M41 22L61 16 M23 54H41 M27 59H37 M29 40L32 34L35 40L41 41L36 45L37 51L32 48L27 51L28 45L23 41Z",
  },
  espace: {
    office: "La poste des étoiles", lines: ["LA POSTE", "DES ÉTOILES"], caption: "UN BISOU EN ORBITE", motif: "Saturne et les étoiles",
    ink: "#706180", paper: "#e6dfe7",
    drawing: "M17 32A15 15 0 1 0 47 32A15 15 0 1 0 17 32 M18 26C-9 34 6 51 36 40C67 29 67 14 45 24 M17 31Q-1 42 30 37Q61 26 47 28 M10 6V16 M5 11H15 M54 46V58 M48 52H60 M45 5V11 M42 8H48 M18 54V60 M15 57H21",
  },
} satisfies Record<AdventureId, {
  office: string; lines: string[]; caption: string; motif: string;
  ink: string; paper: string; drawing: string;
}>;
