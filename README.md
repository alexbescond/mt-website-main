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
- Personnalisation et récapitulatif modifiable sur le site : compagnon, nombre de cartes, aventures, surnom, prénom de l’enfant, photo et consentement. Stripe Checkout recueille ensuite le nom du destinataire, l’e-mail et l’adresse de livraison avec autocomplétion, puis le paiement. La démonstration s’arrête avant Stripe sans demander de coordonnées.
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

Le staging est connecté à Stripe sandbox et un parcours de paiement a été validé sur l’URL hébergée. D1, R2 et KV sont provisionnés séparément pour staging et production ; le domaine Cloudflare et le domaine expéditeur Resend sont vérifiés. La production reste privée derrière Cloudflare Access, avec Stripe live et les notifications activés. Avant l’ouverture publique, il reste à fixer les caractéristiques des cartes, les délais, le vendeur et les conditions de vente, puis autoriser l’ouverture. Les textes de `/informations` doivent être finalisés.

La création des cartes, l’impression et l’expédition restent manuelles : aucun générateur d’illustrations, imprimeur ni prestataire postal n’a été connecté. Le site enregistre la cadence et les aventures, mais ne déclenche aucun envoi physique automatique. Le délai de préparation du premier envoi reste à définir. Les commandes payées sont disponibles dans D1 et leurs photos dans R2 pour cette préparation. Le suivi client et l’atelier de préparation sont implémentés, avec une file de confirmations et de notifications d’expédition. Les e-mails sont configurés en staging et en production, avec Resend et un traitement toutes les cinq minutes. Le staging envoie des e-mails préfixés « [TEST] » pour les commandes Stripe sandbox ; la production traite uniquement les commandes live. Le mode démo reste sans envoi. Voir [le guide des notifications](docs/TRACKING.md). Les reçus Stripe sont indépendants.

Voir [DEPLOY.md](DEPLOY.md) pour le déploiement, Stripe et le traitement d’une commande. Les images fournies et le visuel de ski sont décrits dans [docs/ASSETS.md](docs/ASSETS.md).

## Commandes et compatibilité

La migration `0003_postcards.sql` reconstruit la table `orders` pour retirer la restriction historique aux deux aventures de livres, tout en conservant les commandes, montants, références Stripe, clés photo et index existants. Les anciennes lignes restent `product_type='book'`. Les nouvelles sont `postcards`, avec `card_quantity`, `unit_price_cents`, `card_adventures` (tableau JSON ordonné) et `send_interval_days=7`. La colonne historique `book` conserve la première aventure, uniquement pour compatibilité ; `card_adventures` est la source du programme complet.

La migration `0006_stripe_delivery.sql` ajoute `recipient_name` et `delivery_status`. Le webhook conserve le nom complet reçu de Stripe sans le découper artificiellement ; les anciennes commandes conservent leurs champs prénom/nom et leur adresse. Les coordonnées incomplètes ou hors France métropolitaine placent la livraison en vérification sans perdre la trace du paiement. Voir [le fonctionnement Stripe](DEPLOY.md#stripe-en-test).

Le nom `pacifierPhoto` et la clé R2 `pacifier` sont conservés pour les deux types de compagnons. Ni prénom de l’enfant, surnom du compagnon ni photo ne sont transmis à Stripe. Le serveur impose la quantité de 1 à 5, le nombre exact d’aventures et le tarif correspondant ; le webhook vérifie le total enregistré. Les expéditions sont espacées de 7 jours après le premier départ par défaut, ou regroupées selon le choix du client, sans garantir des dates de réception identiques aux dates d’expédition.

Les fichiers de `conductor-handoff/` sont une archive de l’ancienne refonte livres et ne décrivent plus l’offre actuelle. La configuration et les environnements actuels sont décrits dans [DEPLOY.md](DEPLOY.md).

## Hypothèses économiques à confirmer

Au 2 novembre 2026, [La Poste](https://www.laposte.fr/tarif-lettre-verte) affiche 1,52 € pour une Lettre verte jusqu’à 20 g (1,67 € annoncé pour 2027), et [Stripe](https://stripe.com/fr/pricing) 1,5 % + 0,25 € pour une carte standard de l’EEE. À 25 € le lot, cinq affranchissements 2026 et un paiement laissent environ **16,78 €** avant impression, création, manipulation, éventuelle TVA, acquisition client et marge ; ce montant n’est pas un bénéfice.

Exemple de travail, à remplacer par un devis : 0,80 € d’impression + 0,20 € de création numérique + 0,70 € de préparation par carte, en plus du timbre. Cela laisserait environ 8,28 € par lot de 5 avant fiscalité, acquisition client, frais fixes et incidents. Ces coûts sont des hypothèses, pas des tarifs fournisseur vérifiés. La cinquième carte ajoute 4 € de chiffre d’affaires par rapport au lot de 4 (21 €), au lieu de seulement 3 € avec un lot de 4 à 22 €. Le coût marginal doit rester inférieur à 4 €, frais Stripe supplémentaires compris. Un traitement très manuel peut rendre cette remise trop forte ; valider le coût de chaque illustration et le temps réel avant l’ouverture.

### Choix de livraison

`deliveryMode` vaut `weekly` par défaut ou `together` pour un envoi groupé à partir de 2 cartes. Les tarifs des lots sont conservés ; la remise supplémentaire est définie par `TOGETHER_DISCOUNT_CENTS` dans `src/lib/catalog.ts` (75 centimes par carte). Le serveur calcule le prix et normalise une carte seule en envoi hebdomadaire sans remise.

Appliquer `migrations/0005_delivery_mode.sql` avant de déployer cette version. Les anciennes commandes restent hebdomadaires. Pour un envoi groupé, le planning donne la même date à chaque carte ; une fois toutes les cartes prêtes, l’opérateur confirme leur expédition en une seule action et une seule notification est préparée.

### Codes promotionnels

Les codes sont saisis directement dans Stripe Checkout (`allow_promotion_codes=true`). Le site ne demande plus d’e-mail ni de code promo avant la redirection. Stripe gère seul l’éligibilité, les pourcentages ou montants fixes, les expirations et les plafonds d’utilisation. Créer les coupons et codes dans le Dashboard Stripe, séparément en sandbox et en production ; la base D1 ne crée aucune promotion Stripe.

`WELCOME10` peut être configuré à −10 % avec la restriction native `first_time_transaction`. **Dans le parcours invité actuel, cette restriction ne garantit pas une seule utilisation par personne ou par e-mail.** Stripe considère les sessions invitées comme éligibles ; une restriction fiable par historique exige de réutiliser un client Stripe identifié avant la création du Checkout. Créer systématiquement un nouveau Customer ne résout pas ce problème. Ne pas annoncer une protection stricte par e-mail.

Une promotion de 100 % est prise en charge sans carte bancaire : Stripe Checkout le gère automatiquement pour les paiements ponctuels dont le total est nul. Ne pas transmettre `payment_method_collection`, réservé au mode abonnement (`subscription`). Voir [les commandes gratuites dans Stripe](https://docs.stripe.com/payments/checkout/no-cost-orders). L’ancien code privé D1 est désactivé : il n’est pas recréé automatiquement comme offre publique. Stripe permet de réserver un code à un identifiant Customer, mais notre parcours invité ne rattache pas la session à un client existant ; la restriction à l’adresse e-mail de l’offre précédente n’est donc plus disponible dans ce parcours.

Le serveur calcule le sous-total après la remise d’envoi groupé. Le webhook signé vérifie la session, le mode, la devise, le sous-total d’origine et l’égalité `total = sous-total − réduction Stripe` (sans supplément de livraison ni taxe). Les règles et arrondis de la promotion restent ceux de Stripe. Il enregistre `amount_cents`, `coupon_discount_cents`, `stripe_promotion_code_id`, `stripe_promotion_code` et `stripe_coupon_id`, puis déclenche la préparation une seule fois. Un appel à Stripe développe la promotion pour conserver le code lisible ; un échec temporaire laisse le webhook réessayable sans lancer la préparation.

Un total de 0 € est confirmé seulement par `checkout.session.completed` avec `payment_status=no_payment_required` (ou un statut payé), après les mêmes contrôles. `paid` signifie alors commande confirmée, même offerte. La page de retour ne valide jamais une commande. L’adresse et l’e-mail proviennent de Stripe ; les coordonnées incomplètes ou hors zone restent soumises à vérification avant préparation.

Appliquer les migrations `0007_coupons.sql` et `0008_stripe_promotions.sql` dans l’ordre. La première conserve les anciens prix et autorise un montant net nul ; la seconde désactive les règles D1 et distingue les nouvelles sessions Stripe des anciennes. Les sessions déjà ouvertes gardent leur prix et leurs contrôles historiques, et les anciens formulaires avec code sont invités à recharger la page. Les colonnes et règles historiques sont conservées pour audit. Voir [DEPLOY.md](DEPLOY.md) pour la configuration des offres et les contraintes de déploiement.

Références : [promotions Stripe](https://docs.stripe.com/payments/checkout/discounts), [commandes gratuites](https://docs.stripe.com/payments/checkout/no-cost-orders).
