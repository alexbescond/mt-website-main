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

L’atelier contient les filtres de préparation, d’expédition du jour, de commandes terminées, une recherche et une pagination. Une commande donne accès aux coordonnées, à la personnalisation, à la photo et au planning. Le menu « Statut » permet de choisir directement « À venir », « En préparation », « Prête à partir » ou « Expédiée », y compris pour revenir en arrière. Choisir « Expédiée » ouvre une confirmation avec la date réelle du dépôt.

## Contenu des e-mails

Les trois modèles sont rédigés dans `src/lib/email-templates.ts`, puis utilisés par `src/lib/notifications.ts` pour les envois Resend :

- **Confirmation** (« Votre commande A1B2C3D4 est confirmée ») : paiement reçu, contenu des cartes, préparation de la première carte et rythme des suivantes. Bouton « Suivre mes cartes ».
- **Expédition** (« Carte 2 expédiée — commande A1B2C3D4 ») : numéro de la carte, date réelle d’expédition et renvoi vers le suivi pour les envois restants. Bouton « Suivre mes cartes ».
- **Nouveau lien de suivi** (« Votre lien de suivi — commande A1B2C3D4 ») : accès au suivi sans compte, contenu de la page et indication pour ignorer une demande non sollicitée. Bouton « Accéder au suivi ».

Les e-mails s’adressent aux parents : le ton reste chaleureux mais sobre, sans diminutifs, métaphores de voyage ni points d’exclamation. Le vocabulaire ludique du site (« carnet de voyage », « compagnon ») n’y est pas repris. Chaque e-mail possède un objet avec la référence de commande, un aperçu de boîte de réception, une version HTML et une version texte. La présentation reprend le crème, le vert sauge et le terracotta du site, avec des polices système pour rester lisible sans chargement externe. Le lien privé est valable 30 jours ; le pied de page indique comment le renouveler et renvoie aux questions fréquentes. Les dates annoncées sont celles des expéditions, sans promesse de date de réception. Aucune donnée personnelle d’enfant ni photo n’est incluse.

## Activer les e-mails Resend

Adresse expéditrice retenue : `no-reply@les-aventures-de-doudou-tetine.com` (variable `EMAIL_FROM`). Le domaine `les-aventures-de-doudou-tetine.com` doit être actif et vérifié dans Resend avant l’activation des envois.

Les notifications sont transactionnelles : confirmation de commande, expédition d’une carte, renouvellement du lien. Aucun e-mail marketing, aucune photo ou donnée d’enfant dans les e-mails.

1. Ajouter et vérifier le domaine expéditeur dans Resend. Installer les enregistrements DNS indiqués par Resend (SPF et DKIM), puis configurer DMARC. Choisir une adresse de réponse réellement consultée. Désactiver le suivi des ouvertures et des clics pour ces e-mails contenant un lien d’accès privé.
2. Créer une clé API Resend avec la permission d’envoi, limitée au domaine du site. La conserver dans un gestionnaire de mots de passe, jamais dans Git ni dans le chat. L’installer dans le Worker avec l’invite sécurisée :

       npx wrangler secret put RESEND_API_KEY --env production --name mt-main-production --profile matetine

3. Renseigner EMAIL_FROM avec une adresse du domaine vérifié et EMAIL_REPLY_TO avec l’adresse de réponse. `EMAIL_ENABLED=true` est configuré dans `vars` pour le staging et `env.production.vars` pour la production. Chaque environnement possède un cron unique `*/5 * * * *` dans `triggers.crons` (notifications toutes les cinq minutes, rétention à 03:15 UTC). TRACKING_LINK_SECRET et RESEND_API_KEY doivent être installés séparément sur chaque Worker. Pour le staging, utiliser `--env '' --name mt-website-main` dans la commande ci-dessus. Aucun binding Cloudflare send_email n’est nécessaire.
4. Appliquer les migrations et déployer après les contrôles habituels. Les contrôles de déploiement exigent l’expéditeur, RESEND_API_KEY, le cron et les noms des secrets de suivi lorsque les e-mails sont activés, en staging comme en production. Ils ne prouvent pas que la clé API est valide ni que le domaine est vérifié.
5. Vérifier une confirmation et une expédition avec une adresse réellement contrôlée. Les tests automatisés simulent l’API Resend et n’envoient rien.

Avec EMAIL_ENABLED=true, les modes test (staging) et live (production) envoient de vrais e-mails via Resend. Chaque environnement traite uniquement ses commandes : test en staging, live en production. Les objets des e-mails de staging commencent par « [TEST] » et leurs liens ouvrent le suivi du staging. Le mode demo n’envoie jamais d’e-mail. En local, garder EMAIL_ENABLED=false dans .dev.vars ; les tests automatisés utilisent des secrets fictifs et simulent Resend.

Les requêtes de préparation et le webhook ne dépendent pas de la disponibilité de Resend : une notification est enregistrée dans D1 dans la même transaction que l’événement métier. Le cron toutes les cinq minutes en traite jusqu’à vingt par passage. Une réservation atomique évite les envois concurrents, avec cinq tentatives maximum et délai progressif. Les erreurs réseau, 429, 5xx et conflits temporaires sont réessayés ; Retry-After est respecté. Chaque appel expire après dix secondes. Les erreurs permanentes restent en échec et sont visibles dans l’atelier. Après correction, « Réessayer les notifications en échec » les remet en attente.

Chaque notification utilise une clé d’idempotence Resend stable. Le lien signé est calculé à partir de la création de la notification pour conserver le même contenu lors des nouvelles tentatives ; il expire trente jours après cette création. Resend déduplique les requêtes identiques pendant vingt-quatre heures. Une reprise après cette fenêtre peut encore créer un doublon si l’envoi avait été accepté sans être enregistré en base. Éviter de modifier le contenu, l’expéditeur ou le secret de signature pendant des tentatives en cours : Resend refuse une requête différente portant la même clé dans cette fenêtre.

Le statut envoyé signifie « accepté par Resend », pas reçu ou lu. Consulter le tableau de bord Resend pour les remises, rejets et plaintes ; ces événements ne sont pas synchronisés dans l’atelier. Les reçus Stripe sont indépendants.

## Exploitation

Le cron partagé exécute aussi, chaque jour à 03:15 UTC, le nettoyage des commandes abandonnées et des photos, et supprime les sessions expirées. L’ancien cron quotidien de 03:17 UTC reste reconnu pendant la propagation du déploiement. Un seul déclencheur par environnement suffit. Les photos restent soumises à la rétention de 90 jours à partir de la création de commande. Les données de commande et de notification sont conservées pour l’exploitation ; leur durée administrative définitive reste à fixer.

La fabrication, l’impression et le dépôt postal restent manuels. Aucun transporteur ni imprimeur n’est connecté. L’avancement décrit les opérations enregistrées dans l’atelier, pas l’acheminement postal.

Une annulation, un remboursement ou un changement d’adresse après paiement nécessitent encore un traitement opérateur hors de cet écran. L’atelier ne doit pas être utilisé pour expédier une commande remboursée sans vérification.

Les expéditions hebdomadaires peuvent être annulées depuis le menu de statut, en commençant par la dernière carte expédiée. Pour un envoi groupé, revenir en arrière sur une carte applique le nouveau statut à toutes les cartes du groupe. Le retour en arrière efface la date réelle et conserve les dates prévues. Il est temporairement bloqué pendant l’envoi d’un e-mail. Une notification jamais tentée est supprimée et sera recréée à la prochaine expédition. Une notification déjà tentée est conservée pour éviter un doublon, mais ses relances sont annulées ; un e-mail déjà envoyé ne peut pas être rappelé.

Documentation officielle :

- [Envoi d’un e-mail avec Resend](https://resend.com/docs/api-reference/emails/send-email)
- [Clés d’idempotence](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Erreurs de l’API](https://resend.com/docs/api-reference/errors)
