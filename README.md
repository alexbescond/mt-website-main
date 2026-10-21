# Les vacances de ma tétine

Site de livres papier personnalisés à partir de la photo de la tétine d’un enfant. Deux aventures : **sous les tropiques** et **au ski**, au prix provisoire de **29,90 €**, livraison en France métropolitaine incluse. La photo de l’enfant est facultative.

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

- Accueil adaptatif, deux livres, aperçu feuilletable, FAQ, page 404 et informations du projet.
- Formulaire en trois étapes avec prénom de l’enfant, photos et aperçu, consentements, nom/prénom du parent, e-mail, adresse et récapitulatif modifiable.
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
