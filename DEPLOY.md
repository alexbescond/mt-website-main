# Déploiement Cloudflare

Les conventions suivent [ka-website-mediation](https://github.com/alexbescond/ka-website-mediation) : Astro statique avec endpoints Worker, TypeScript, `wrangler.jsonc`, Node 24, D1, R2, génération de types, Playwright et GitHub Actions. Les ressources de ce projet doivent rester séparées de celles du site de médiation.

## Ressources

Compte utilisé : `alexandre.bescond@protonmail.com` (`2956aa8b799d46de715a248f6ef2207d`), profil Wrangler local `matetine`. D1 est créé avec la juridiction UE et KV est provisionné. R2 n'est pas encore activé sur ce compte : le binding `PHOTOS` reste commenté et la démonstration fonctionne sans collecte. Le code refuse les paiements si ce binding manque.

Aperçu mis à jour le 3 novembre 2026 : **https://mt-website-main.alexandre-bescond.workers.dev**. Migrations `0001` à `0004` appliquées. Mode `demo`, aucun secret Stripe installé, e-mails désactivés. Version Worker : `7819db62-4a18-45a8-a86e-5bd293205f5c`.

Pour tester le suivi, ouvrir [l’atelier de démonstration](https://mt-website-main.alexandre-bescond.workers.dev/admin?demo=1), faire avancer une carte puis cliquer sur « Ouvrir le suivi client » dans le même onglet. La simulation reste dans le navigateur : elle ne crée aucune commande dans D1 et n’envoie aucun e-mail. [Le carnet client](https://mt-website-main.alexandre-bescond.workers.dev/suivi?demo=1) est aussi accessible directement. Cloudflare Access reste requis ; `/api/health` confirme `ok: true`, `mode: demo`, `checkout: false`.

| Ressource | Nom / binding |
| --- | --- |
| Worker | `mt-website-main` |
| Base D1 | `mt-orders` / `DB` |
| Bucket R2 privé | `mt-private-photos` / `PHOTOS` |
| KV Astro | `SESSION` |
| Limiteur | `CHECKOUT_LIMITER`, 5 requêtes par minute et par IP |

Authentifier Wrangler sur le compte cible et vérifier l’identité avec `npx wrangler whoami`. Un profil nommé peut être utilisé pour éviter de modifier celui des autres projets : `npx wrangler auth create matetine`, puis `npx wrangler auth activate matetine` dans ce checkout.

```sh
npx wrangler d1 create mt-orders --jurisdiction eu
npx wrangler r2 bucket create mt-private-photos --jurisdiction eu
npx wrangler kv namespace create SESSION
```

Ces commandes servent au provisionnement initial ; ne pas recréer D1/KV déjà présents. Pour les photos, activer R2 dans le tableau de bord Cloudflare, créer le bucket ci-dessus puis décommenter le binding `PHOTOS` de `wrangler.jsonc` avec `jurisdiction: "eu"`. Reporter les identifiants dans les bindings existants, sans ajouter de doublons ni renommer les bindings. Garder R2 privé : pas de domaine public ni d’accès `r2.dev`.

```sh
npm run deploy:www
```

Cette commande vérifie le projet, le compile, contrôle la configuration, applique les migrations distantes puis déploie. Pour un premier aperçu, conserver `CHECKOUT_MODE=demo`, `SITE_INDEXABLE=false` et `LEGAL_APPROVED=false`. Vérifier `/`, `/personnaliser`, `/api/config` et `/api/health` sur l’URL workers.dev retournée.

## Domaine

Le domaine définitif n'est pas encore acheté. L'aperçu est publié sur `workers.dev` et protégé par Cloudflare Access depuis le 17 octobre 2026. Seule l'adresse `alexandre.bescond@protonmail.com` est autorisée, avec une session de 24 heures. La règle porte sur **tout le trafic de ce Worker**, production et prévisualisations comprises. Les pages, images et API renvoient les visiteurs non authentifiés vers la connexion Cloudflare.

La protection est gérée dans le tableau de bord : Workers & Pages → `mt-website-main` → Access. Application Access : `130ff87f-c294-4177-b9a3-099c05851f13`. La politique existante `Photo Print staging owner`, limitée à l'adresse ci-dessus, est réutilisée sans modification ; elle est partagée avec un autre projet. Pour changer les destinataires de ce site, créer une politique propre au site plutôt que modifier la politique partagée. Cette configuration Access est indépendante de Wrangler et reste active après un déploiement du code. Le site conserve aussi `noindex`.

Avant de connecter Stripe pour des transactions réelles, prévoir l'ouverture du site et l'accès au webhook : la protection actuelle intercepte également les requêtes de Stripe. Ne pas activer le paiement tant que le webhook signé n'est pas accessible et testé.

Quand la zone `les-vacances-de-ma-tetine.com` est active dans le compte cible, ajouter :

```json
"routes": [
  { "pattern": "les-vacances-de-ma-tetine.com", "custom_domain": true }
]
```

Le Worker utilise HTTPS sur le domaine publié. L’origine canonique et les retours Stripe sont `https://les-vacances-de-ma-tetine.com`. Les paiements sont refusés sur les domaines de prévisualisation ; localhost reste utilisable en test. Pour un test hébergé avant le domaine définitif, utiliser un Worker/stockage séparés et configurer son `SITE_ORIGIN` explicitement. Ne pas connecter un aperçu à la base des commandes réelles.

## Stripe en test

1. Dans le compte Stripe choisi, utiliser un environnement de test.
2. Ajouter les secrets du Worker avec les invites sécurisées (jamais dans Git ou dans le chat) :

```sh
npx wrangler secret put STRIPE_SECRET_KEY --name mt-website-main
npx wrangler secret put STRIPE_WEBHOOK_SECRET --name mt-website-main
```

3. Créer le webhook Stripe `https://les-vacances-de-ma-tetine.com/api/stripe/webhook` pour `checkout.session.completed`, `checkout.session.async_payment_succeeded` et `checkout.session.expired`. Utiliser la version API du SDK installé, visible dans `node_modules/stripe/esm/apiVersion.js`, pour les snapshots d’événements.
4. Régler `CHECKOUT_MODE` sur `test`, reconstruire et redéployer. Le code exige une clé `sk_test_` et un secret webhook ; le total est calculé sur le serveur selon la quantité : 700, 1200, 1650, 2100 ou 2500 centimes pour 1 à 5 cartes.
5. Faire un achat de test, vérifier la commande D1 `paid`, son montant, sa photo privée et la confirmation. Tester également l’annulation et le renvoi d’un événement. Aucun test Stripe connecté n’est effectué automatiquement.

En local : copier `.dev.vars.example` vers `.dev.vars`, y renseigner les secrets sandbox, passer `CHECKOUT_MODE` à `test` localement et lancer `npm run preview`. Stripe CLI peut transférer les événements vers `http://localhost:8787/api/stripe/webhook` ; utiliser le secret `whsec_` spécifique à cette session CLI.

La redirection de succès ne marque jamais une commande comme payée. Le webhook signé est seul responsable de cette transition. Seuls les paiements par carte sont proposés. Les traitements de remboursements/litiges se font dans Stripe et doivent être intégrés à l’exploitation avant l’ouverture.

## Production

Finaliser le vendeur, les conditions, le format/nombre de pages, les délais, les taxes, les modalités de réclamation, le contact confidentialité et l’organisation de la fabrication. Puis configurer un webhook de production avec les secrets de production, `CHECKOUT_MODE=live` et `LEGAL_APPROVED=true`. Ne passer `SITE_INDEXABLE=true` qu’à l’ouverture publique.

Le contrôle de déploiement vérifie la présence des noms de secrets, pas leur validité ni le contenu juridique. La conformité, la fabrication et la livraison demandent une validation humaine.

## GitHub Actions et Workers Builds

`.github/workflows/e2e.yml` lance les contrôles à chaque PR, à chaque push sur `main` et manuellement. Le job `deploy` est conditionné au succès de ces tests et à la variable GitHub `CLOUDFLARE_DEPLOY_ENABLED=true`.

Configurer dans l’environnement GitHub `production` :

- `CLOUDFLARE_API_TOKEN` : token limité au compte et aux ressources nécessaires (Workers, D1, KV, R2 ; routes/zone si domaine personnalisé).
- `CLOUDFLARE_ACCOUNT_ID` : identifiant du compte cible.

Les clés Stripe restent dans les secrets du Worker. Activer le déploiement GitHub seulement après le provisionnement initial. Aucune modification des secrets, paramètres de branche ou connexions GitHub n’est faite par le code du dépôt.

Alternative homogène avec le site de médiation : Workers Builds sur `main`, Node 24, installation `npm ci` + Chromium, déploiement `npm run deploy:www`, autres branches `npm run preview:www`. Choisir **un seul** mécanisme de déploiement automatique pour éviter les publications en double.

## Préparer les commandes

Les achats apparaissent dans le tableau D1 `orders`. Filtrer **`status='paid' AND payment_mode='live'`** pour la fabrication. Les colonnes `product_type`, `card_quantity`, `card_adventures` (JSON dans l’ordre des envois), `send_interval_days`, `companion_type`, `companion_name`, `child_name`, `notes`, adresse et clés photo contiennent les informations nécessaires. Pour `product_type=postcards`, préparer une carte par aventure et expédier à J0, J+7, J+14, J+21 et J+28 selon la quantité, à partir du premier envoi effectif. Les anciennes commandes `product_type=book` doivent continuer à être traitées comme des livres. Récupérer les photos via le tableau de bord R2 authentifié ou :

```sh
npx wrangler r2 object get mt-private-photos/orders/ID_COMMANDE/pacifier --remote --jurisdiction eu --file .context/photo-tetine
```

Ne jamais publier ces photos, ni les ajouter à Git. Utiliser un espace d’exploitation privé pour la fabrication. L’interface privée `/admin` permet maintenant de consulter les commandes, les photos, le planning et de confirmer chaque expédition. La page `/suivi` présente cet avancement au parent. La création des cartes et les dépôts postaux restent manuels, sans intégration imprimeur ni transporteur. Appliquer la migration `0004_tracking.sql` et suivre [la configuration des accès et notifications](docs/TRACKING.md) avant activation.

Le cron quotidien à 03:17 UTC supprime les commandes non payées après 7 jours, et les photos des commandes payées après 90 jours. Il conserve les données de commande payée ; une politique comptable/administrative complète reste à définir. Le code limite chaque passage à 100 commandes ; surveiller les logs `retention_complete` et adapter le traitement avant une montée en charge.

## Exploitation et retour arrière

`/api/health` confirme une lecture D1 et indique si le paiement est configuré, sans secret ni donnée client. Surveiller aussi les erreurs du webhook dans Stripe et les logs Worker. Un cookie de confirmation perdu n’empêche pas l’enregistrement d’une commande payée ; la recherche opérateur se fait via l’identifiant présent dans les métadonnées Stripe.

```sh
npx wrangler deployments list --name mt-website-main
npx wrangler rollback VERSION_ID --name mt-website-main
```

Un rollback Worker n’annule ni les migrations D1 ni les paiements Stripe.

Références : [Cloudflare Workers](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [Astro Cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/), [Stripe Checkout](https://docs.stripe.com/checkout/quickstart).
