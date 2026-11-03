# Déploiement Cloudflare

Les conventions suivent [ka-website-mediation](https://github.com/alexbescond/ka-website-mediation) : Astro statique avec endpoints Worker, TypeScript, `wrangler.jsonc`, Node 24, D1, R2, génération de types, Playwright et GitHub Actions. Les ressources de ce projet doivent rester séparées de celles du site de médiation.

## Ressources

Compte utilisé : `alexandre.bescond@protonmail.com` (`2956aa8b799d46de715a248f6ef2207d`), profil Wrangler local `matetine`. Depuis le 3 novembre 2026, staging et production utilisent deux Workers et des stockages indépendants. R2 est activé ; les bases D1 et les buckets R2 sont en juridiction UE. Les migrations `0001` à `0004` sont appliquées dans les deux bases.

| Ressource | Staging (environnement par défaut) | Production (`env.production`) |
| --- | --- | --- |
| Worker | `mt-website-main` | `mt-main-production` |
| URL | https://mt-website-main.alexandre-bescond.workers.dev | https://les-aventures-de-doudou-tetine.com |
| Paiement | `test`, Stripe sandbox | `live` préparé dans Git ; Worker déployé encore en `demo` |
| Base D1 / `DB` | `mt-orders` | `mt-orders-production` |
| Bucket privé / `PHOTOS` | `mt-private-photos-staging` | `mt-private-photos-production` |
| KV / `SESSION` | `9f532fb7c2034ef29d5e63881533b225` | `72e6c73cbf1e400e902d27c8f4bbd53a` |
| Limiteur `CHECKOUT_LIMITER` | namespace `1001` | namespace `1002` |
| E-mails | désactivés | activation préparée ; clé dédiée installée, release en attente |

Les deux sites sont protégés par Cloudflare Access. La production n’a ni URL `workers.dev` ni URL de prévisualisation. `SITE_INDEXABLE=false` et `LEGAL_APPROVED=false` restent configurés dans les deux environnements. Les secrets Stripe de test sont installés uniquement sur le staging. Des secrets distincts d’administration et de suivi sont maintenant installés dans les deux environnements. Une clé Resend existe en staging sans autoriser d’envoi. Une nouvelle clé dédiée à la production, limitée à l’envoi depuis le domaine du site, est installée sur le Worker production ; aucun e-mail n’a été envoyé pendant cette préparation.

Un paiement sandbox de 16,50 € pour trois cartes a été validé depuis le formulaire hébergé : redirection Checkout, webhook `checkout.session.completed`, commande `paid` en mode `test`, photo R2 privée et suivi client avec trois cartes. Aucune fabrication ni expédition réelle n’en découle. La production conserve [l’atelier de démonstration](https://les-aventures-de-doudou-tetine.com/admin?demo=1) et [le suivi fictif](https://les-aventures-de-doudou-tetine.com/suivi?demo=1), avec simulation dans le navigateur uniquement.

Authentifier Wrangler sur le compte cible. Le profil local est associé à ce checkout avec `npx wrangler auth activate matetine .` ; `--profile matetine` permet aussi de le sélectionner explicitement dans les commandes distantes.

```sh
npm run deploy:staging
npm run deploy:www
```

Exécuter seulement la commande de l’environnement voulu. Chacune lance les contrôles, construit le bon Worker, vérifie ses bindings et secrets requis, applique les migrations à sa base puis déploie. Les ressources existent déjà : ne pas les recréer. Garder R2 privé, sans domaine public ni accès `r2.dev`.

## Circuit de release

1. Travailler sur une branche et ouvrir une PR vers `main` ; la CI exécute les types, tests Worker/navigateur et l’audit des dépendances. Une PR ne déploie rien et ne reçoit pas les secrets Cloudflare.
2. Fusionner dans `main` : après une nouvelle exécution réussie des contrôles, GitHub Actions déploie le Worker **staging**. Vérifier le formulaire, un paiement sandbox, le webhook et le suivi sur l’URL staging. Le SHA Git est conservé dans le résumé du déploiement.
3. Ouvrir une PR **`main` → `prod`** pour promouvoir la version validée. La CI refuse les PR vers `prod` provenant d’une autre branche ou d’un fork. Vérifier que le code proposé correspond bien à celui testé en staging.
4. Fusionner cette PR avec **Create a merge commit**, en conservant `main` : après les tests, GitHub Actions déploie **production**. Ne pas utiliser squash/rebase pour ces promotions répétées entre deux branches permanentes. Aucun développement direct sur `prod` ; toute correction passe d’abord par `main` et le staging.
5. Vérifier `/api/health` avec Access, les pages, les logs et la livraison des événements Stripe. Conserver l’identifiant de version Worker et le SHA Git pour un retour arrière.

| Déclenchement | Environnement GitHub | Worker |
| --- | --- | --- |
| Push après merge dans `main` | `staging` | `mt-website-main` |
| Push après merge dans `prod` | `production` | `mt-main-production` |
| PR vers `main` ou `prod` | aucun déploiement | tests uniquement |

Les branches `main` et `prod` sont protégées : PR obligatoire, contrôle `e2e` réussi, conversations résolues, pas de force-push ni de suppression, y compris pour les administrateurs. Aucune seconde approbation humaine n’est imposée à ce dépôt individuel : la fusion de la PR constitue la décision de release. La branche `prod` a été initialisée depuis `main` ; sa création n’a déclenché aucun déploiement. Le nouveau workflow prend effet après fusion de cette PR de configuration dans `main`, puis promotion vers `prod`.

Pour relancer une release sans nouveau commit, utiliser **Actions → e2e → Run workflow** en sélectionnant `main` ou `prod`. Sur une autre branche, ce déclenchement lance seulement les tests. Les commandes locales restent disponibles pour un dépannage ; une release habituelle passe par Git.

`wrangler.jsonc` est la source de configuration ; les secrets restent propres à chaque Worker. Ne jamais partager la base ou les photos de production avec une prévisualisation. Une URL de version seule ne crée pas un environnement isolé.

Avec Astro, sélectionner l’environnement **à la compilation** : `npm run build` pour staging, `npm run build:production` pour production (`CLOUDFLARE_ENV=production`). Déployer ensuite `dist/server/wrangler.json`. Ajouter `--env production` après un build staging ne remplace pas le build de production. Le contrôle `npm run check:deploy -- staging|production` refuse un mauvais Worker, domaine ou stockage.

Les migrations sont versionnées et testées en staging avant production. Favoriser les ajouts compatibles avec l’ancien code ; retirer une colonne seulement dans une release ultérieure. Un rollback du Worker ne restaure pas D1/R2. Pour le lancement, un déploiement complet est suffisant ; les déploiements progressifs pourront être ajoutés quand le trafic le justifiera, après vérification de la compatibilité entre versions.

## Domaine

Le domaine définitif est `les-aventures-de-doudou-tetine.com` ; la zone Cloudflare est active et le domaine est vérifié pour l’envoi dans Resend (vérifié le 3 novembre 2026). Seule l’adresse `alexandre.bescond@protonmail.com` est autorisée par Access, avec une session de 24 heures. L’application principale protège le Worker staging, y compris ses prévisualisations, et possède une destination explicite pour le domaine de production. Les pages et API redirigent les visiteurs non authentifiés vers Cloudflare Access.

La protection est gérée dans le tableau de bord : Workers & Pages → `mt-website-main` → Access. Application Access : `130ff87f-c294-4177-b9a3-099c05851f13`. La politique existante `Photo Print staging owner`, limitée à l'adresse ci-dessus, est réutilisée sans modification ; elle est partagée avec un autre projet. Pour changer les destinataires de ce site, créer une politique propre au site plutôt que modifier la politique partagée. Cette configuration Access est indépendante de Wrangler et reste active après un déploiement du code. Le site conserve aussi `noindex`.

Exception autorisée et activée : application `mt-main-staging Stripe webhook` (`52f33fb4-1abf-4348-9065-4c5101fe8238`), uniquement sur `mt-website-main.alexandre-bescond.workers.dev/api/stripe/webhook`. Sa politique Bypass permet à Stripe d’atteindre ce point d’entrée ; le Worker exige toujours une signature Stripe valide. Une requête sans signature ou avec une mauvaise signature renvoie HTTP 400. Le bypass de production est maintenant activé, après accord du propriétaire, dans une application distincte `mt-main-production Stripe webhook` (`42ac6989-808e-4fbf-8f03-aa2298b80dee`), uniquement sur `les-aventures-de-doudou-tetine.com/api/stripe/webhook`. Il réutilise la politique Bypass existante sans la modifier. Les pages publiques, `/admin` et `/api/config` restent protégés par Access. Tant que les secrets Stripe live ne sont pas installés, le webhook atteint bien le Worker mais renvoie HTTP 503 `Webhook indisponible.` ; après installation, vérifier le rejet HTTP 400 des signatures manquantes ou invalides. Les règles Access par chemin couvrent aussi leurs sous-chemins ; aucun endpoint n’est exposé sous le chemin du webhook.

Le domaine est raccordé au Worker par une route déclarée dans `wrangler.jsonc`. Elle utilise les enregistrements DNS existants, avec le proxy Cloudflare activé :

```json
"routes": [
  { "pattern": "les-aventures-de-doudou-tetine.com/*", "zone_name": "les-aventures-de-doudou-tetine.com" }
]
```

Cette route, déclarée dans `env.production`, appartient à `mt-main-production` et couvre tous les chemins du domaine principal. Les enregistrements DNS de Resend restent indépendants. Le staging a une liste de routes vide. Chaque environnement utilise son propre `SITE_ORIGIN` pour les retours Stripe ; les autres domaines de prévisualisation ne peuvent pas créer de paiement. Localhost reste utilisable en test.

## Stripe en test

1. Utiliser le sandbox **mt-main-staging** (`acct_1UXgG5LOJ3UTEBt1`), rattaché au compte distinct **mt-main-production** (`acct_1UXgF6L9j58VN417`). Ne pas utiliser le compte Photo Print d’un autre projet. L’activation des paiements réels du nouveau compte reste à faire avant une ouverture publique.
2. Ajouter les secrets du Worker avec les invites sécurisées (jamais dans Git ou dans le chat) :

```sh
npx wrangler secret put STRIPE_SECRET_KEY --env '' --name mt-website-main --profile matetine
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env '' --name mt-website-main --profile matetine
```

3. Le webhook sandbox existe : `https://mt-website-main.alexandre-bescond.workers.dev/api/stripe/webhook`, événements `checkout.session.completed`, `checkout.session.async_payment_succeeded` et `checkout.session.expired`. Il utilise la version API `2026-09-30.endive`, correspondant au SDK installé. À une mise à jour du SDK, vérifier cette compatibilité.
4. Régler `CHECKOUT_MODE` sur `test`, reconstruire et redéployer. Le code exige une clé `sk_test_` ou `rk_test_` et un secret webhook ; le total est calculé sur le serveur selon la quantité : 700, 1200, 1650, 2100 ou 2500 centimes pour 1 à 5 cartes.
5. Faire un achat de test, vérifier la commande D1 `paid`, son montant, sa photo privée et la confirmation. Tester également l’annulation et le renvoi d’un événement. Aucun test Stripe connecté n’est effectué automatiquement.

Carte de test : `4242 4242 4242 4242`, date future, CVC `123`, coordonnées fictives. Les e-mails restent désactivés en staging ; le suivi s’ouvre depuis la confirmation de paiement.

En local : copier `.dev.vars.example` vers `.dev.vars`, y renseigner les secrets sandbox et lancer `npm run preview` (`CHECKOUT_MODE=test` par défaut). Stripe CLI peut transférer les événements vers `http://localhost:8787/api/stripe/webhook` ; utiliser le secret `whsec_` spécifique à cette session CLI. Pour une démonstration sans secrets : construire puis lancer `npx wrangler dev --config dist/server/wrangler.json --port 8787 --var CHECKOUT_MODE:demo`.

La redirection de succès ne marque jamais une commande comme payée. Le webhook signé est seul responsable de cette transition. Seuls les paiements par carte sont proposés. Les traitements de remboursements/litiges se font dans Stripe et doivent être intégrés à l’exploitation avant l’ouverture.

## Production

### État vérifié le 3 novembre 2026 et passage en paiement réel

Le Worker déployé `mt-main-production` est toujours en `CHECKOUT_MODE=demo`, avec `LEGAL_APPROVED=false`, `EMAIL_ENABLED=false` ; seule la clé API Stripe live reste à installer. Les secrets `ADMIN_PASSWORD`, `TRACKING_LINK_SECRET`, `RESEND_API_KEY` et `STRIPE_WEBHOOK_SECRET` ont été installés. Les valeurs propres à la production sont conservées localement dans `.context/production-bootstrap-secrets.json` et `.context/production-email-secret.json` (ignorés par Git, permissions 0600). La clé Resend ne permet que l’envoi depuis le domaine du site. Le bypass Access du webhook de production a été appliqué avec accord du propriétaire : un POST atteint désormais le Worker (HTTP 503, secrets Stripe manquants), tandis que `/`, `/admin` et `/api/config` restent redirigés vers Access (302). Le propriétaire indique avoir terminé la vérification Stripe ; l’autorisation effective des paiements reste à confirmer via le compte. Le webhook live `we_1UXnKZL9j58VN417VicbafYJ` est actif, avec les trois événements Checkout attendus et la version `2026-10-28.endive` proposée par le Dashboard (même famille compatible que le SDK `2026-09-30.endive`). Son secret est sauvegardé dans `.context/production-stripe-webhook-secret.json` (0600, ignoré par Git). La migration additive `0005_delivery_mode.sql` a été appliquée en production. Aucun paiement réel n’a été effectué lors de cet audit.

À la demande du propriétaire, la configuration source prépare désormais les paiements réels : `CHECKOUT_MODE=live`, notifications activées et deux crons. Elle n’a pas été déployée : la clé API live et la vérification de l’autorisation Stripe restent à terminer ; l’exception Access du webhook est en place. Le propriétaire a explicitement demandé de préparer les paiements réels et de compléter les informations vendeur ultérieurement : `LEGAL_APPROVED=false` reflète toujours la page inachevée mais ne bloque plus techniquement le checkout. Aucun contenu juridique n’a été marqué approuvé et aucun paiement réel n’est encore ouvert.

Pour terminer l’activation :

1. Vérifier l’e-mail dans Stripe et terminer l’activation du compte **mt-main-production** (`acct_1UXgF6L9j58VN417`), notamment les informations d’entreprise et les versements. Confirmer que les paiements réels sont autorisés.
2. Compléter `src/pages/informations.astro` avec les informations réelles du vendeur, les conditions de vente, les délais et la confidentialité. La page actuelle reste explicitement une version de préparation. Le propriétaire complétera cette partie séparément ; la vérification technique des paiements ne constitue pas une validation de ces informations.
3. Créer un webhook **live** sur `https://les-aventures-de-doudou-tetine.com/api/stripe/webhook`, version API compatible avec le SDK, avec `checkout.session.completed`, `checkout.session.async_payment_succeeded` et `checkout.session.expired`. Installer son secret propre et la clé restreinte `rk_live_` (ou `sk_live_`) du bon compte sur le Worker de production. Les secrets sandbox ne conviennent pas. Pour la clé restreinte du site, accorder uniquement **Checkout Sessions → Écrire** ; le code ne fait que créer des sessions et vérifie les signatures de webhook localement. Les autres autorisations restent sur Aucune. Voir [les clés restreintes Stripe](https://docs.stripe.com/keys/restricted-api-keys). Vérifier les appels avec cette clé avant ouverture.
4. Installer les cinq secrets ci-dessous via les invites sécurisées. Le mot de passe atelier doit avoir au moins 24 caractères, et le secret des liens de suivi au moins 32. Utiliser une clé Resend autorisée à envoyer depuis le domaine vérifié.

```sh
npx wrangler secret put STRIPE_SECRET_KEY --env production --profile matetine
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production --profile matetine
npx wrangler secret put ADMIN_PASSWORD --env production --profile matetine
npx wrangler secret put TRACKING_LINK_SECRET --env production --profile matetine
npx wrangler secret put RESEND_API_KEY --env production --profile matetine
```

Avec le fichier source `wrangler.jsonc`, `--env production` sélectionne déjà `mt-main-production` ; ne pas ajouter `--name mt-main-production`, qui peut cibler `mt-main-production-production` avec Wrangler.

5. Rendre le seul chemin `/api/stripe/webhook` accessible à Stripe dans Access, sans désactiver la vérification de signature. Un POST sans signature doit renvoyer HTTP 400 avec `Signature manquante.`. La visibilité du reste du site est indépendante ; l’accès des acheteurs et aux liens de suivi devra être ouvert pour les ventes publiques.
6. Dans `env.production`, régler `CHECKOUT_MODE=live`, `EMAIL_ENABLED=true`, l’adresse de réponse client, et les crons `["17 3 * * *", "*/5 * * * *"]`. Conserver le staging en test. Le contrôle à l’exécution refuse aussi le live sur localhost/HTTP et si l’atelier, les liens de suivi ou les notifications ne sont pas configurés.
7. Exécuter `WRANGLER_PROFILE=matetine npm run check:payments`. Cette commande construit la production et exige explicitement le mode live ; un build démo ne constitue plus un résultat positif de préparation aux paiements. Elle contrôle les bindings, les noms des secrets, les notifications, les crons et l’accès au webhook. Elle ne crée aucune commande, ne débite aucune carte et ne valide pas les valeurs des secrets ni l’activation du compte Stripe.
8. Passer les tests puis suivre le circuit `main` → `prod`, qui applique les migrations et déploie. Vérifier `/api/health` (`mode=live`, `checkout=true`), le Checkout hébergé, puis faire réaliser un paiement réel par le propriétaire du compte et vérifier l’événement live, la commande `paid`, le suivi et l’e-mail. Un test avec Stripe simulé ne remplace pas cette vérification réelle.

Finaliser le vendeur, les conditions, le format/nombre de pages, les délais, les taxes, les modalités de réclamation, le contact confidentialité et l’organisation de la fabrication. Puis configurer un webhook de production avec les secrets de production, `CHECKOUT_MODE=live`. Le marqueur `LEGAL_APPROVED` reste indépendant de cette activation technique. Ne passer `SITE_INDEXABLE=true` qu’à l’ouverture publique.

Ces réglages se font dans `env.production`, avec les secrets sur **mt-main-production** (`--env production`). Configurer aussi les notifications Resend : domaine expéditeur vérifié, secret Worker `RESEND_API_KEY`, `EMAIL_FROM=no-reply@les-aventures-de-doudou-tetine.com`, `EMAIL_REPLY_TO` et `EMAIL_ENABLED=true`. Voir [le guide des notifications](docs/TRACKING.md#activer-les-e-mails-resend). Le contrôle de déploiement live exige la clé Resend et les deux crons `17 3 * * *` (rétention) et `*/5 * * * *` (notifications). Le Worker démo encore déployé n’a aucun cron ; la configuration source prépare les deux crons de production. Le staging conserve seulement celui de rétention ; vérifier le quota de crons du compte avant activation. L’ouverture publique d’Access est une décision distincte d’un déploiement.

Le contrôle de déploiement vérifie la présence des noms de secrets, pas leur validité ni le contenu juridique. La conformité, la fabrication et la livraison demandent une validation humaine.

## GitHub Actions et Workers Builds

`.github/workflows/e2e.yml` lance les contrôles sur les PR vers `main`/`prod`, les push sur ces branches et les déclenchements manuels. Le job `deploy` attend leur réussite et sélectionne l’environnement d’après la branche, sans entrée utilisateur permettant de changer la cible. La variable historique `CLOUDFLARE_DEPLOY_ENABLED` n’est plus utilisée. Un secret manquant fait échouer explicitement le job avant toute migration.

Les environnements GitHub sont créés et limités à leur branche : `staging` autorise uniquement `main`, `production` uniquement `prod`. La présence des deux paramètres suivants a été vérifiée dans chacun le 3 novembre 2026 :

- le **secret** `CLOUDFLARE_API_TOKEN`, pour déployer le Worker et appliquer les migrations D1 ;
- la **variable** `CLOUDFLARE_ACCOUNT_ID`, déjà configurée à `2956aa8b799d46de715a248f6ef2207d`.

Les clés Stripe, Resend et les mots de passe restent dans les secrets du Worker, sans copie dans GitHub. Ne pas utiliser un jeton OAuth de connexion Wrangler comme secret CI : utiliser un jeton API de déploiement dédié à chaque environnement. Le périmètre préparé est `Individual Workers Editor` sur le Worker correspondant et `D1 Write` sur le compte ; ce dernier autorise toutes les bases D1 du compte, même si le workflow contrôle la base cible. Le jeton production ajoute `Workers Routes Write` et `Zone Read` uniquement sur `les-aventures-de-doudou-tetine.com`. Les jetons ont été préparés avec une expiration d’un an ; prévoir leur renouvellement avant échéance.

GitHub ne permet pas de relire la valeur des secrets : leur présence est vérifiée, mais leurs droits seront validés lors du premier déploiement automatique après fusion de la PR de configuration. Aucun déploiement GitHub n’a encore été effectué à ce stade.

Les releases sont sérialisées par branche/environnement. Un nouveau push n’interrompt pas un déploiement ni une migration en cours ; seules les anciennes exécutions de tests de PR sont annulées. Chaque release reconstruit le bon environnement et contrôle le Worker, l’origine et les bindings avant les migrations et la publication.

GitHub Actions est le mécanisme unique de release : ne pas activer en parallèle Workers Builds sur les mêmes Workers. `npm run preview:www` charge une version du Worker staging sans lui envoyer le trafic principal ; ses bindings restent ceux du staging, ce n’est pas une base indépendante par PR. Cloudflare Access, l’indexation et l’activation des paiements réels restent des réglages distincts du choix de branche.

## Préparer les commandes

Les achats apparaissent dans le tableau D1 `orders`. Filtrer **`status='paid' AND payment_mode='live'`** pour la fabrication. Les colonnes `product_type`, `card_quantity`, `card_adventures` (JSON dans l’ordre des envois), `send_interval_days`, `companion_type`, `companion_name`, `child_name`, `notes`, adresse et clés photo contiennent les informations nécessaires. Pour `product_type=postcards`, préparer une carte par aventure et expédier à J0, J+7, J+14, J+21 et J+28 selon la quantité, à partir du premier envoi effectif. Les anciennes commandes `product_type=book` doivent continuer à être traitées comme des livres. Récupérer les photos via le tableau de bord R2 authentifié ou :

```sh
npx wrangler r2 object get mt-private-photos-production/orders/ID_COMMANDE/pacifier --remote --jurisdiction eu --profile matetine --file .context/photo-tetine
```

Ne jamais publier ces photos, ni les ajouter à Git. Utiliser un espace d’exploitation privé pour la fabrication. L’interface privée `/admin` permet maintenant de consulter les commandes, les photos, le planning et de confirmer chaque expédition. La page `/suivi` présente cet avancement au parent. La création des cartes et les dépôts postaux restent manuels, sans intégration imprimeur ni transporteur. Appliquer la migration `0004_tracking.sql` et suivre [la configuration des accès et notifications](docs/TRACKING.md) avant activation.

Le cron quotidien à 03:17 UTC supprime les commandes non payées après 7 jours, et les photos des commandes payées après 90 jours. Il conserve les données de commande payée ; une politique comptable/administrative complète reste à définir. Le code limite chaque passage à 100 commandes ; surveiller les logs `retention_complete` et adapter le traitement avant une montée en charge.

## Exploitation et retour arrière

`/api/health` confirme une lecture D1 et indique si le paiement est configuré, sans secret ni donnée client. Surveiller aussi les erreurs du webhook dans Stripe et les logs Worker. Un cookie de confirmation perdu n’empêche pas l’enregistrement d’une commande payée ; la recherche opérateur se fait via l’identifiant présent dans les métadonnées Stripe.

```sh
npx wrangler deployments list --env production --name mt-main-production --profile matetine
npx wrangler rollback VERSION_ID --env production --name mt-main-production --profile matetine
```

Pour le staging, remplacer par `--env '' --name mt-website-main`. Un rollback Worker n’annule ni les migrations D1 ni les paiements Stripe. Vérifier la compatibilité de la version choisie avec le schéma et les ressources actuels.

Références : [Cloudflare Workers](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [versions et déploiements](https://developers.cloudflare.com/workers/versions-and-deployments/), [rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [Astro Cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/), [Stripe Checkout](https://docs.stripe.com/checkout/quickstart).
