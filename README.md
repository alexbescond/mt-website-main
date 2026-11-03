# Les aventures de mon doudou et ma tétine

Site de **cartes postales papier personnalisées** avec le doudou ou la tétine de l’enfant. De 1 à 5 cartes, un paiement unique, une aventure par carte et une expédition tous les 7 jours à partir du premier envoi. Les frais de port en France métropolitaine sont inclus. Photo du compagnon obligatoire, surnom facultatif. Aucune photo de l’enfant n’est demandée ni acceptée pour les nouvelles commandes.

| Cartes | Total | Par carte |
| --- | --- | --- |
| 1 | 7 € | 7 € |
| 2 | 12 € | 6 € |
| 3 | 16,50 € | 5,50 € |
| 4 | 21 € | 5,25 € |
| 5 | 25 € | 5 € |

La grille est définie dans `src/lib/catalog.ts` et recalculée côté serveur. Aucun abonnement ni renouvellement automatique.

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

- Accueil adaptatif, catalogue `/aventures`, page `/notre-histoire`, aperçus recto-verso, FAQ, menu mobile, page 404 et informations du projet.
- Formulaire en trois étapes avec choix du compagnon, nombre de cartes, aventures par menu déroulant, planning des envois, surnom, prénom de l’enfant, photos et aperçu, consentements, nom/prénom du parent, e-mail, adresse et récapitulatif modifiable.
- Worker Astro : validation serveur, limites de taille et de fréquence, détection JPG/PNG/WebP, stockage privé R2, commandes D1, Stripe Checkout et webhook signé.
- Prix fixé côté serveur ; retries idempotents ; paiement confirmé uniquement par webhook ; confirmation privée avec cookie HttpOnly.
- Nettoyage quotidien des commandes abandonnées après 7 jours et des photos après 90 jours. Le traitement est limité à 100 commandes par exécution ; surveiller la volumétrie avant montée en charge.
- Polices locales, images WebP, CSP, robots/noindex sur les aperçus, aucun traqueur.
- GitHub Actions : types, tests dans le runtime Worker, parcours Playwright desktop/mobile, audit puis déploiement conditionnel de `main`.

## Suivi des cartes

Le parent retrouve ses cartes dans `/suivi`, grâce à un lien privé reçu par e-mail ou depuis sa confirmation de paiement. L’atelier `/admin` permet de planifier les départs et de faire avancer chaque carte : à venir, en préparation, prête à partir, expédiée.

En mode démonstration, essayer `/suivi?demo=1` et `/admin?demo=1`. Les changements fictifs se partagent dans le même onglet ; aucun e-mail n’est envoyé. Voir [le guide du suivi](docs/TRACKING.md) pour les accès privés, les migrations et l’activation des notifications.

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

Le site démarre volontairement en démonstration sur le compte Cloudflare personnel : D1 et KV sont provisionnés. Il reste à activer R2 pour les photos, connecter un compte Stripe, acheter et relier le domaine, puis fixer les caractéristiques des cartes, les délais, le vendeur et les conditions de vente. Les textes de `/informations` sont des informations de préparation et doivent être finalisés.

La création des cartes, l’impression et l’expédition restent manuelles : aucun générateur d’illustrations, imprimeur ni prestataire postal n’a été connecté. Le site enregistre la cadence et les aventures, mais ne déclenche aucun envoi physique automatique. Le délai de préparation du premier envoi reste à définir. Les commandes payées sont disponibles dans D1 et leurs photos dans R2 pour cette préparation. Le suivi client et l’atelier de préparation sont implémentés, avec une file de confirmations et de notifications d’expédition. Les e-mails restent désactivés tant que Cloudflare Email Sending et le domaine expéditeur ne sont pas configurés. Les reçus Stripe sont indépendants.

Voir [DEPLOY.md](DEPLOY.md) pour le déploiement, Stripe et le traitement d’une commande. Les images fournies et le visuel de ski sont décrits dans [docs/ASSETS.md](docs/ASSETS.md).

## Commandes et compatibilité

La migration `0003_postcards.sql` reconstruit la table `orders` pour retirer la restriction historique aux deux aventures de livres, tout en conservant les commandes, montants, références Stripe, clés photo et index existants. Les anciennes lignes restent `product_type='book'`. Les nouvelles sont `postcards`, avec `card_quantity`, `unit_price_cents`, `card_adventures` (tableau JSON ordonné) et `send_interval_days=7`. La colonne historique `book` conserve la première aventure, uniquement pour compatibilité ; `card_adventures` est la source du programme complet.

Le nom `pacifierPhoto` et la clé R2 `pacifier` sont conservés pour les deux types de compagnons. Ni prénom, surnom ni photo ne sont transmis à Stripe. Le serveur impose la quantité de 1 à 5, le nombre exact d’aventures et le tarif correspondant ; le webhook vérifie le total enregistré. Les expéditions sont espacées de 7 jours après le premier départ, sans garantir des dates de réception identiques aux dates d’expédition.

La configuration Cloudflare, le mode démo et les workflows de déploiement sont inchangés. Les fichiers de `conductor-handoff/` sont une archive de l’ancienne refonte livres et ne décrivent plus l’offre actuelle.

## Hypothèses économiques à confirmer

Au 2 novembre 2026, [La Poste](https://www.laposte.fr/tarif-lettre-verte) affiche 1,52 € pour une Lettre verte jusqu’à 20 g (1,67 € annoncé pour 2027), et [Stripe](https://stripe.com/fr/pricing) 1,5 % + 0,25 € pour une carte standard de l’EEE. À 25 € le lot, cinq affranchissements 2026 et un paiement laissent environ **16,78 €** avant impression, création, manipulation, éventuelle TVA, acquisition client et marge ; ce montant n’est pas un bénéfice.

Exemple de travail, à remplacer par un devis : 0,80 € d’impression + 0,20 € de création numérique + 0,70 € de préparation par carte, en plus du timbre. Cela laisserait environ 8,28 € par lot de 5 avant fiscalité, acquisition client, frais fixes et incidents. Ces coûts sont des hypothèses, pas des tarifs fournisseur vérifiés. La cinquième carte ajoute 4 € de chiffre d’affaires par rapport au lot de 4 (21 €), au lieu de seulement 3 € avec un lot de 4 à 22 €. Le coût marginal doit rester inférieur à 4 €, frais Stripe supplémentaires compris. Un traitement très manuel peut rendre cette remise trop forte ; valider le coût de chaque illustration et le temps réel avant l’ouverture.
