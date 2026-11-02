# Les aventures de mon doudou et ma tétine

Site de livres papier personnalisés avec le **doudou ou la tétine** de l’enfant. Deux aventures en démonstration : **Sous les cocotiers** et **La tête dans les flocons**, au prix provisoire existant de **29,90 €**, livraison en France métropolitaine incluse. La photo du compagnon et celle de l’enfant sont nécessaires ; le portrait original est destiné au cadre de la scène finale. Le surnom du compagnon est facultatif.

Domaine prévu (pas encore acheté) : **https://les-vacances-de-ma-tetine.com**. La démonstration utilise une URL provisoire `workers.dev`, protégée par Cloudflare Access et réservée à `alexandre.bescond@protonmail.com`.

**Démonstration publiée : https://mt-website-main.alexandre-bescond.workers.dev**

## Démarrer

Node 24, comme `ka-website-mediation`.

```sh
npm ci
npm run db:migrate:local
npm run dev
```

Le mode `demo` fonctionne sans secret : toutes les étapes sont accessibles, les photos restent en mémoire dans le navigateur, aucun paiement ni aucune commande ne sont créés. `npm run preview` compile puis sert le Worker sur http://localhost:8787.

## Ce qui est implémenté

- Accueil adaptatif, catalogue `/aventures`, page `/notre-histoire`, aperçu feuilletable, FAQ, menu mobile, page 404 et informations du projet.
- Formulaire en trois étapes avec choix du compagnon, surnom, prénom de l’enfant, photos et aperçu, consentements, nom/prénom du parent, e-mail, adresse et récapitulatif modifiable.
- Worker Astro : validation serveur, limites de taille et de fréquence, détection JPG/PNG/WebP, stockage privé R2, commandes D1, Stripe Checkout et webhook signé.
- Prix fixé côté serveur ; retries idempotents ; paiement confirmé uniquement par webhook ; confirmation privée avec cookie HttpOnly.
- Nettoyage quotidien des commandes abandonnées après 7 jours et des photos après 90 jours. Le traitement est limité à 100 commandes par exécution ; surveiller la volumétrie avant montée en charge.
- Polices locales, images WebP, CSP, robots/noindex sur les aperçus, aucun traqueur.
- GitHub Actions : types, tests dans le runtime Worker, parcours Playwright desktop/mobile, audit puis déploiement conditionnel de `main`.

## Vérifier

```sh
npx playwright install chromium
npm run check
npm audit --audit-level=high
```

Les tests Worker utilisent de vrais stockages D1/R2 locaux avec Stripe simulé. Playwright construit le Worker et utilise des ressources isolées et un fichier de secrets vide. Aucune API Stripe réelle ni ressource de production n’est appelée par les tests.

## Organisation

| Emplacement | Rôle |
| --- | --- |
| `src/pages` | Pages Astro et route API |
| `src/lib/catalog.ts` | Livres et prix communs au site et au serveur |
| `src/lib/payments.ts` | Stripe, stockage, suivi et rétention |
| `src/lib/validation.ts` | Validation du formulaire et des fichiers |
| `src/scripts` | Interactions du navigateur |
| `src/worker.ts` | Entrée Cloudflare, sécurité, robots, cron |
| `migrations` | Schéma D1 |
| `tests` | Tests Worker et navigateur |
| `.github/workflows/e2e.yml` | CI et déploiement optionnel |

## Avant l’ouverture des ventes

Le site démarre volontairement en démonstration sur le compte Cloudflare personnel : D1 et KV sont provisionnés. Il reste à activer R2 pour les photos, connecter un compte Stripe, acheter et relier le domaine, puis fixer les caractéristiques du livre, les délais, le vendeur et les conditions de vente. Les textes de `/informations` sont des informations de préparation et doivent être finalisés.

La création du livre et son impression restent manuelles : aucun générateur d’histoires, imprimeur ni prestataire d’envoi n’a été choisi ou connecté. Les commandes payées sont disponibles dans D1 et leurs photos dans R2 pour cette préparation. Aucun e-mail automatique n’est envoyé par ce code ; les reçus peuvent être activés dans Stripe.

Voir [DEPLOY.md](DEPLOY.md) pour le déploiement, Stripe et le traitement d’une commande. Les images fournies et le visuel de ski sont décrits dans [docs/ASSETS.md](docs/ASSETS.md).

## Refonte doudou et tétine du 21 octobre 2026

La refonte conserve les workflows GitHub Actions, `wrangler.jsonc`, `astro.config.mjs`, les scripts de déploiement, les identifiants des ressources et le mode de paiement existants. Le nom commercial n’impose pas de changer le domaine ou `SITE_ORIGIN`.

La migration additive `0002_companions.sql` ajoute `companion_type` (les anciennes commandes restent `tetine`) et `companion_name`, sans supprimer les données existantes. Le nom historique `pacifierPhoto` et la clé R2 `pacifier` restent utilisés pour les deux types de compagnons afin de préserver le stockage et la rétention existants.

Le choix du compagnon est validé côté serveur, enregistré en D1 et utilisé pour le titre générique dans Stripe. Aucun prénom d’enfant, surnom ou photo n’est transmis à Stripe. Le retour d’annulation conserve le type de compagnon dans l’URL. Les tests utilisent uniquement des données fictives.

Les cartes postales et le carnet de voyage sont présentés comme des idées en préparation. Aucun de ces produits n’est facturé. Les trois autres destinations restent des pistes non commandables. La configuration R2/Stripe, la validation des livres et les informations commerciales restent les prérequis déjà documentés à l’ouverture des ventes.
