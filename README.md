# Les aventures de mon doudou et ma tétine

Site de **cartes postales papier personnalisées** avec le doudou ou la tétine de l’enfant. De 1 à 5 cartes, un paiement unique, une aventure par carte et une expédition tous les 7 jours par défaut, ou toutes les cartes en un seul envoi. Les frais de port en France métropolitaine sont inclus. Photo du compagnon obligatoire, surnom facultatif. Aucune photo de l’enfant n’est demandée ni acceptée pour les nouvelles commandes.

| Cartes | Total | Par carte |
| --- | --- | --- |
| 1 | 7 € | 7 € |
| 2 | 12 € | 6 € |
| 3 | 16,50 € | 5,50 € |
| 4 | 21 € | 5,25 € |
| 5 | 25 € | 5 € |

La grille est définie dans `src/lib/catalog.ts` et recalculée côté serveur. Aucun abonnement ni renouvellement automatique.

Domaine de production : **https://les-aventures-de-doudou-tetine.com**, toujours en démonstration privée. **Staging Stripe test : https://mt-website-main.alexandre-bescond.workers.dev**. Deux Workers, bases D1, buckets R2 privés et espaces KV distincts ; les deux sites restent protégés par Cloudflare Access. Seul le webhook Stripe du staging dispose d’une exception, avec signature obligatoire.

## Démarrer

Node 24, comme `ka-website-mediation`.

```sh
npm ci
npm run db:migrate:local
npm run dev
```

`npm run preview` compile puis sert le Worker sur http://localhost:8787 en mode `test` ; renseigner les secrets sandbox dans `.dev.vars` pour Stripe. Pour une démo sans secrets, exécuter `npm run build` puis `npx wrangler dev --config dist/server/wrangler.json --port 8787 --var CHECKOUT_MODE:demo` : les photos restent dans le navigateur et aucune commande n’est créée.

Les releases passent par GitHub : une PR fusionnée dans `main` déploie le staging après les tests ; une PR `main` → `prod` fusionnée avec un commit de merge déploie la production après les tests. Les environnements GitHub sont séparés et disposent chacun du secret de déploiement Cloudflare. Voir [le circuit de release](DEPLOY.md#circuit-de-release). Les commandes locales `npm run deploy:staging` et `npm run deploy:www` restent disponibles pour le dépannage.

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

Les tests Worker utilisent de vrais stockages D1/R2 locaux avec Stripe et Resend simulés. Playwright construit le Worker et utilise des ressources isolées et un fichier de secrets vide. Aucune API Stripe ou Resend réelle ni ressource de production n’est appelée par les tests.

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

Le staging est connecté à Stripe sandbox et un parcours de paiement a été validé sur l’URL hébergée. D1, R2 et KV sont provisionnés séparément pour staging et production ; le domaine Cloudflare et le domaine expéditeur Resend sont vérifiés. La production reste volontairement en démonstration privée. Avant les ventes, il reste à activer Stripe réel, les secrets et notifications de production, fixer les caractéristiques des cartes, les délais, le vendeur et les conditions de vente, puis autoriser l’ouverture publique. Les textes de `/informations` doivent être finalisés.

La création des cartes, l’impression et l’expédition restent manuelles : aucun générateur d’illustrations, imprimeur ni prestataire postal n’a été connecté. Le site enregistre la cadence et les aventures, mais ne déclenche aucun envoi physique automatique. Le délai de préparation du premier envoi reste à définir. Les commandes payées sont disponibles dans D1 et leurs photos dans R2 pour cette préparation. Le suivi client et l’atelier de préparation sont implémentés, avec une file de confirmations et de notifications d’expédition. Les e-mails restent désactivés tant que Resend (clé API) et le domaine expéditeur ne sont pas configurés. Les reçus Stripe sont indépendants.

Voir [DEPLOY.md](DEPLOY.md) pour le déploiement, Stripe et le traitement d’une commande. Les images fournies et le visuel de ski sont décrits dans [docs/ASSETS.md](docs/ASSETS.md).

## Commandes et compatibilité

La migration `0003_postcards.sql` reconstruit la table `orders` pour retirer la restriction historique aux deux aventures de livres, tout en conservant les commandes, montants, références Stripe, clés photo et index existants. Les anciennes lignes restent `product_type='book'`. Les nouvelles sont `postcards`, avec `card_quantity`, `unit_price_cents`, `card_adventures` (tableau JSON ordonné) et `send_interval_days=7`. La colonne historique `book` conserve la première aventure, uniquement pour compatibilité ; `card_adventures` est la source du programme complet.

Le nom `pacifierPhoto` et la clé R2 `pacifier` sont conservés pour les deux types de compagnons. Ni prénom, surnom ni photo ne sont transmis à Stripe. Le serveur impose la quantité de 1 à 5, le nombre exact d’aventures et le tarif correspondant ; le webhook vérifie le total enregistré. Les expéditions sont espacées de 7 jours après le premier départ par défaut, ou regroupées selon le choix du client, sans garantir des dates de réception identiques aux dates d’expédition.

Les fichiers de `conductor-handoff/` sont une archive de l’ancienne refonte livres et ne décrivent plus l’offre actuelle. La configuration et les environnements actuels sont décrits dans [DEPLOY.md](DEPLOY.md).

## Hypothèses économiques à confirmer

Au 2 novembre 2026, [La Poste](https://www.laposte.fr/tarif-lettre-verte) affiche 1,52 € pour une Lettre verte jusqu’à 20 g (1,67 € annoncé pour 2027), et [Stripe](https://stripe.com/fr/pricing) 1,5 % + 0,25 € pour une carte standard de l’EEE. À 25 € le lot, cinq affranchissements 2026 et un paiement laissent environ **16,78 €** avant impression, création, manipulation, éventuelle TVA, acquisition client et marge ; ce montant n’est pas un bénéfice.

Exemple de travail, à remplacer par un devis : 0,80 € d’impression + 0,20 € de création numérique + 0,70 € de préparation par carte, en plus du timbre. Cela laisserait environ 8,28 € par lot de 5 avant fiscalité, acquisition client, frais fixes et incidents. Ces coûts sont des hypothèses, pas des tarifs fournisseur vérifiés. La cinquième carte ajoute 4 € de chiffre d’affaires par rapport au lot de 4 (21 €), au lieu de seulement 3 € avec un lot de 4 à 22 €. Le coût marginal doit rester inférieur à 4 €, frais Stripe supplémentaires compris. Un traitement très manuel peut rendre cette remise trop forte ; valider le coût de chaque illustration et le temps réel avant l’ouverture.

### Choix de livraison

`deliveryMode` vaut `weekly` par défaut ou `together` pour un envoi groupé à partir de 2 cartes. Les tarifs des lots sont conservés ; la remise supplémentaire est définie par `TOGETHER_DISCOUNT_CENTS` dans `src/lib/catalog.ts` (75 centimes par carte). Le serveur calcule le prix et normalise une carte seule en envoi hebdomadaire sans remise.

Appliquer `migrations/0005_delivery_mode.sql` avant de déployer cette version. Les anciennes commandes restent hebdomadaires. Pour un envoi groupé, le planning donne la même date à chaque carte ; une fois toutes les cartes prêtes, l’opérateur confirme leur expédition en une seule action et une seule notification est préparée.

### Codes promotionnels

Appliquer aussi `migrations/0006_coupons.sql`. Le récapitulatif propose un champ « Vous avez un code promo ? » et une validation serveur via `POST /api/coupon`. Les règles sont dans D1 (`coupons`), pas dans le JavaScript du navigateur ni dans Stripe. `WELCOME10` offre 10 % sur une première commande confirmée par adresse e-mail. L’offre `personal-free` offre 100 % uniquement à l’adresse configurée, sans limite d’utilisation ni date d’expiration par défaut. Son code et son adresse autorisée sont stockés sous forme d’empreintes SHA-256 dans la migration. La saisie est insensible à la casse et aux espaces de début/fin, sans supprimer les points ou les suffixes `+` des e-mails.

Une seule promotion par commande, calculée après la remise d’envoi groupé, arrondie au centime sur le total du lot. Les colonnes `subtotal_cents`, `coupon_id`, `coupon_label`, `coupon_percent_off`, `coupon_discount_cents` et `amount_cents` conservent le prix accepté, même si l’offre est modifiée ensuite. `unit_price_cents` reste le prix par carte avant le code. Les commandes en cours réservent une utilisation lors d’un insert SQL conditionnel atomique ; les aperçus n’en réservent aucune. Les limites et l’historique sont séparés par mode Stripe (`test`/`live`). Une session expirée libère sa réservation via le webhook, une commande confirmée la conserve. En cas d’échec temporaire de Stripe, la même tentative reprend la réservation et le prix. Sans événement d’expiration, une réservation abandonnée reste bloquée jusqu’au nettoyage des commandes non confirmées après 7 jours. Un remboursement ne rétablit pas automatiquement l’éligibilité.

Pour une promotion, Stripe reçoit un lot unique au montant net, afin d’éviter les écarts d’arrondi par carte. À 0 €, Stripe ne collecte aucun moyen de paiement. Le webhook signé `checkout.session.completed` accepte `payment_status=no_payment_required` uniquement pour une commande enregistrée à 0 €, avec contrôle de la session, du mode, de la devise et du montant. La commande passe alors à `paid` (commande confirmée, même offerte), crée son suivi et rejoint l’atelier habituel. Aucun objet Coupon Stripe n’est nécessaire.

Gestion initiale via D1 : `enabled=0` désactive une offre pour les nouvelles commandes ; `starts_at`/`expires_at` sont des timestamps Unix en millisecondes ; `max_redemptions` plafonne les commandes réservées ou confirmées. Les sessions déjà créées conservent le prix accordé. Les tests utilisent des codes et e-mails fictifs pour l’offre privée. L’éligibilité repose sur l’adresse déclarée à la commande, sans vérification de possession de la boîte mail.
