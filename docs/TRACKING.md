# Suivi des cartes et atelier

## Essayer en local

Pour la démo sans Stripe, lancer `npm run build` puis `npx wrangler dev --config dist/server/wrangler.json --port 8787 --var CHECKOUT_MODE:demo`, et ouvrir sur http://localhost:8787 :

- /suivi?demo=1 : carnet de voyage fictif du parent ;
- /admin?demo=1 : atelier interactif, puis lien « Ouvrir le suivi client » pour constater les changements.

La démonstration utilise uniquement sessionStorage dans l’onglet courant. Aucun paiement, aucune commande réelle, aucun envoi d’e-mail. Le bouton Réinitialiser restaure l’exemple. Ces exemples sont accessibles uniquement lorsque CHECKOUT_MODE=demo. Ils ne consultent aucune commande réelle.

## Données et paiement

La migration 0004_tracking.sql ajoute order_cards, tracking_sessions, admin_sessions et notification_outbox. Elle crée aussi les cartes des commandes de cartes postales déjà payées, sans envoyer de confirmation rétroactive. Les anciennes commandes de livres restent inchangées.

Le webhook Stripe enregistre atomiquement le paiement, les cartes et une notification de confirmation. Ses répétitions ne recréent ni cartes ni notifications et ne réinitialisent pas leur avancement.

Chaque carte passe de « À venir » à « En préparation », « Prête à partir », puis « Expédiée ». L’atelier permet de prévoir le premier départ. Les suivants sont espacés de sept jours calendaires. Chaque dépôt réel recalcule les dates prévues des cartes suivantes ; les dates déjà réalisées sont conservées. Les jours sont affichés en Europe/Paris, y compris aux changements d’heure. Une carte ne peut pas être expédiée avant les précédentes, avant le paiement ou dans le futur. Il n’existe pas de statut « Livrée » sans preuve de réception.

Les mutations utilisent une version de carte et un identifiant d’écriture pour éviter qu’un double clic, deux onglets ou une requête répétée ne créent deux notifications ou n’écrasent une nouvelle version.

## Accès du parent

/confirmation propose un accès direct à /suivi après paiement. Cet accès initial est limité à 24 heures côté serveur. Les e-mails contiennent ensuite un lien signé HMAC valable 30 jours.

Le secret du lien est placé dans le fragment de l’URL, retiré immédiatement de la barre d’adresse, puis échangé contre une session HttpOnly, SameSite=Lax et Secure en HTTPS. Le secret de session est aléatoire et seule son empreinte SHA-256 est stockée. La session dure 30 jours. Le lien est réutilisable pendant sa validité pour ouvrir le suivi sur un autre appareil.

Un parent peut demander un nouveau lien en fournissant son e-mail et sa référence. La réponse est identique qu’une commande existe ou non. Les demandes sont limitées par IP et regroupées par commande sur des fenêtres de quinze minutes. Une référence courte seule n’autorise jamais l’accès.

L’API client renvoie les aventures, les états, les dates et le surnom du compagnon ; elle ne renvoie ni adresse, ni e-mail, ni prénom de l’enfant, ni photo privée. Le lien reste une clé d’accès privée. Les pages et API privées ont no-store et noindex, et une politique de référent restrictive.

## Accès de l’opérateur

Configurer deux secrets distincts via les invites sécurisées :

    npx wrangler secret put ADMIN_PASSWORD --env production --name mt-main-production --profile matetine
    npx wrangler secret put TRACKING_LINK_SECRET --env production --name mt-main-production --profile matetine

Ces commandes ciblent la production. Les secrets sont déjà installés en staging ; pour leur rotation, utiliser `--env '' --name mt-website-main`. Toujours utiliser des valeurs distinctes entre environnements.

Utiliser des valeurs aléatoires conservées dans un gestionnaire de mots de passe : au moins 24 caractères pour ADMIN_PASSWORD, au moins 32 pour TRACKING_LINK_SECRET. Aucun mot de passe par défaut. En local, utiliser .dev.vars (ignoré par Git).

L’atelier /admin utilise une session de douze heures, dont seule l’empreinte est en base. Changer ADMIN_PASSWORD invalide aussi les sessions existantes. La connexion est limitée par IP, la comparaison du secret se fait en temps constant, et toutes les mutations vérifient l’origine. L’API protège les commandes et l’accès aux photos R2. Le mode test ne peut consulter ou modifier que les commandes de test ; le mode live uniquement les commandes live.

L’atelier contient les filtres de préparation, d’expédition du jour, de commandes terminées, une recherche et une pagination. Une commande donne accès aux coordonnées, à la personnalisation, à la photo et au planning. « Marquer comme expédiée » ouvre une confirmation avec la date réelle du dépôt.

## Activer les e-mails Resend

Adresse expéditrice retenue : `no-reply@les-aventures-de-doudou-tetine.com` (variable `EMAIL_FROM`). Le domaine `les-aventures-de-doudou-tetine.com` doit être actif et vérifié dans Resend avant l’activation des envois.

Les notifications sont transactionnelles : confirmation de commande, expédition d’une carte, renouvellement du lien. Aucun e-mail marketing, aucune photo ou donnée d’enfant dans les e-mails.

1. Ajouter et vérifier le domaine expéditeur dans Resend. Installer les enregistrements DNS indiqués par Resend (SPF et DKIM), puis configurer DMARC. Choisir une adresse de réponse réellement consultée. Désactiver le suivi des ouvertures et des clics pour ces e-mails contenant un lien d’accès privé.
2. Créer une clé API Resend avec la permission d’envoi, limitée au domaine du site. La conserver dans un gestionnaire de mots de passe, jamais dans Git ni dans le chat. L’installer dans le Worker avec l’invite sécurisée :

       npx wrangler secret put RESEND_API_KEY --env production --name mt-main-production --profile matetine

3. Renseigner EMAIL_FROM avec une adresse du domaine vérifié et EMAIL_REPLY_TO avec l’adresse de réponse, puis EMAIL_ENABLED=true dans `env.production.vars` de wrangler.jsonc. TRACKING_LINK_SECRET doit être configuré. Activer les crons de production `*/5 * * * *` (notifications) et `17 3 * * *` (rétention) avant les ventes ; aucun cron n’est actif en production démo. Vérifier le quota disponible du compte. Aucun binding Cloudflare send_email n’est nécessaire.
4. Appliquer les migrations et déployer après les contrôles habituels. Les contrôles de déploiement live exigent l’expéditeur, RESEND_API_KEY et les noms des secrets de suivi. Ils ne prouvent pas que la clé API est valide ni que le domaine est vérifié.
5. Vérifier une confirmation et une expédition avec une adresse réellement contrôlée. Les tests automatisés simulent l’API Resend et n’envoient rien.

L’envoi vers des clients réels est conditionné à CHECKOUT_MODE=live et EMAIL_ENABLED=true. En demo et test, aucun envoi même si une clé Resend est présente. Garder ces modes pour le développement local : l’appel HTTPS à Resend est réel en mode live.

Les requêtes de préparation et le webhook ne dépendent pas de la disponibilité de Resend : une notification est enregistrée dans D1 dans la même transaction que l’événement métier. Le cron toutes les cinq minutes en traite jusqu’à vingt par passage. Une réservation atomique évite les envois concurrents, avec cinq tentatives maximum et délai progressif. Les erreurs réseau, 429, 5xx et conflits temporaires sont réessayés ; Retry-After est respecté. Chaque appel expire après dix secondes. Les erreurs permanentes restent en échec et sont visibles dans l’atelier. Après correction, « Réessayer les notifications en échec » les remet en attente.

Chaque notification utilise une clé d’idempotence Resend stable. Le lien signé est calculé à partir de la création de la notification pour conserver le même contenu lors des nouvelles tentatives ; il expire trente jours après cette création. Resend déduplique les requêtes identiques pendant vingt-quatre heures. Une reprise après cette fenêtre peut encore créer un doublon si l’envoi avait été accepté sans être enregistré en base. Éviter de modifier le contenu, l’expéditeur ou le secret de signature pendant des tentatives en cours : Resend refuse une requête différente portant la même clé dans cette fenêtre.

Le statut envoyé signifie « accepté par Resend », pas reçu ou lu. Consulter le tableau de bord Resend pour les remises, rejets et plaintes ; ces événements ne sont pas synchronisés dans l’atelier. Les reçus Stripe sont indépendants.

## Exploitation

Le cron quotidien existant conserve le nettoyage des commandes abandonnées et des photos, et supprime les sessions expirées. Les photos restent soumises à la rétention de 90 jours à partir de la création de commande. Les données de commande et de notification sont conservées pour l’exploitation ; leur durée administrative définitive reste à fixer.

La fabrication, l’impression et le dépôt postal restent manuels. Aucun transporteur ni imprimeur n’est connecté. L’avancement décrit les opérations enregistrées dans l’atelier, pas l’acheminement postal.

Une annulation, un remboursement, un changement d’adresse après paiement ou une correction d’expédition déjà confirmée nécessitent encore un traitement opérateur hors de cet écran. L’atelier ne doit pas être utilisé pour expédier une commande remboursée sans vérification.

Documentation officielle :

- [Envoi d’un e-mail avec Resend](https://resend.com/docs/api-reference/emails/send-email)
- [Clés d’idempotence](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Erreurs de l’API](https://resend.com/docs/api-reference/errors)
