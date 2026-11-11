import { expect, it } from "vitest";
import { preferredLocale } from "../../src/lib/i18n/core";
import { languagePreference } from "../../src/lib/i18n/preferences";

it.each([
  ["de-DE,de;q=0.9,en;q=0.8", "de"],
  ["it-IT,it;q=0.9,es-ES;q=0.8,en;q=0.5", "es"],
  ["fr;q=0.3,en-GB;q=0.9,de;q=0.5", "en"],
  ["en;q=0,de;q=0.7", "de"],
  ["es;q=bad,de;q=0.7", "de"],
  ["en;q=2,es-MX;q=0.5", "es"],
  ["DE-ch,fr;q=0.5", "de"],
  ["fr;q=0,*;q=0.5", "en"],
  ["ja-JP", "fr"],
  [null, "fr"],
])("negotiates %s as %s", (header, expected) => {
  expect(preferredLocale(header)).toBe(expected);
});

const origin = "https://example.com";
function decide(path = "/", cookie = "", language = "de-DE", method = "GET") {
  return languagePreference(new Request(origin + path, { method, headers: { Cookie: cookie, "Accept-Language": language } }));
}

it("uses a temporary same-origin redirect and preserves entry query parameters", () => {
  expect(decide("/?cartes=3&campaign=summer")).toEqual({ personalized: true, location: origin + "/de/?cartes=3&campaign=summer" });
  expect(decide("/index.html").location).toBe(origin + "/de/");
});

it("gives the saved manual choice priority and safely ignores malformed cookies", () => {
  expect(decide("/", "mt_language=es").location).toBe(origin + "/es/");
  expect(decide("/", "mt_language=fr")).toEqual({ personalized: true });
  expect(decide("/", "mt_language=//attacker.example").location).toBe(origin + "/de/");
});

it("keeps explicit language URLs and deep links stable", () => {
  for (const path of ["/en/", "/es.html", "/de/aventures", "/aventures", "/suivi", "/api/config", "/admin", "/images/tetine-ski.webp", "/sitemap.xml", "/robots.txt"]) {
    expect(decide(path, "mt_language=es")).toEqual({ personalized: false });
  }
  expect(decide("/", "", "en", "POST")).toEqual({ personalized: false });
});

it("persists only explicit choices and serves French immediately even if cookies are blocked", () => {
  const result = decide("/?lang=fr", "mt_language=es");
  expect(result.location).toBeUndefined();
  expect(result.cookie).toBe("mt_language=fr; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure");
  expect(decide().cookie).toBeUndefined();
  expect(decide("/api/config?lang=en").cookie).toBeUndefined();
  expect(decide("/?lang=unsupported").cookie).toBeUndefined();
});
