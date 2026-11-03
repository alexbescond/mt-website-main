# Suivi des cartes et atelier

## Essayer en local

Lancer npm run preview puis ouvrir sur http://localhost:8787 :

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

    npx wrangler secret put ADMIN_PASSWORD --name mt-website-main --profile matetine
    npx wrangler secret put TRACKING_LINK_SECRET --name mt-website-main --profile matetine

Utiliser des valeurs aléatoires conservées dans un gestionnaire de mots de passe : au moins 24 caractères pour ADMIN_PASSWORD, au moins 32 pour TRACKING_LINK_SECRET. Aucun mot de passe par défaut. En local, utiliser .dev.vars (ignoré par Git).

L’atelier /admin utilise une session de douze heures, dont seule l’empreinte est en base. Changer ADMIN_PASSWORD invalide aussi les sessions existantes. La connexion est limitée par IP, la comparaison du secret se fait en temps constant, et toutes les mutations vérifient l’origine. L’API protège les commandes et l’accès aux photos R2. Le mode test ne peut consulter ou modifier que les commandes de test ; le mode live uniquement les commandes live.

L’atelier contient les filtres de préparation, d’expédition du jour, de commandes terminées, une recherche et une pagination. Une commande donne accès aux coordonnées, à la personnalisation, à la photo et au planning. « Marquer comme expédiée » ouvre une confirmation avec la date réelle du dépôt.

## Activer les e-mails Cloudflare

Les notifications sont transactionnelles : confirmation de commande, expédition d’une carte, renouvellement du lien. Aucun e-mail marketing, aucune photo ou donnée d’enfant dans les e-mails.

1. Utiliser le compte Cloudflare du projet et le profil matetine. Vérifier les domaines avec npx wrangler email sending list --profile matetine.
2. Disposer de Workers Paid et onboarder le domaine expéditeur à Email Sending. Vérifier SPF, DKIM et DMARC et l’adresse de réponse. Le domaine doit être réellement détenu et validé avant tout envoi.
3. Ajouter un binding send_email nommé EMAIL dans wrangler.jsonc, restreint à l’adresse expéditrice avec allowed_sender_addresses. Le modèle commenté est à remplacer par le domaine validé.
4. Renseigner EMAIL_FROM et EMAIL_REPLY_TO, puis EMAIL_ENABLED=true. TRACKING_LINK_SECRET doit être configuré.
5. Appliquer les migrations et déployer après les contrôles habituels. Les contrôles de déploiement live exigent le binding, l’expéditeur et les noms des secrets de suivi.
6. Vérifier une confirmation et une expédition avec une adresse réellement contrôlée. Les tests automatisés utilisent une doublure du service et n’envoient rien.

L’envoi vers des clients réels est conditionné à CHECKOUT_MODE=live et EMAIL_ENABLED=true. En demo et test, aucun envoi même si le binding existe. Ne pas ajouter remote:true au binding de développement : cela enverrait des e-mails réels depuis le poste.

Les requêtes de préparation et le webhook ne dépendent pas de la disponibilité du service d’e-mail : une notification est enregistrée dans D1 dans la même transaction que l’événement métier. Le cron toutes les cinq minutes en traite jusqu’à vingt par passage. Une réservation atomique évite les envois concurrents, avec cinq tentatives maximum et délai progressif. Les erreurs permanentes restent en échec et sont visibles dans l’atelier. Après correction, « Réessayer les notifications en échec » les remet en attente.

Le statut envoyé de la notification signifie « accepté par le service », pas reçu ou lu. La suppression des destinataires en échec et les événements de remise sont gérés par Email Sending ; les métriques de remise sont à consulter chez Cloudflare.

Le binding ne fournit pas de clé d’idempotence de fournisseur. Un arrêt du Worker entre l’acceptation du message et son enregistrement en base peut donc entraîner un doublon lors d’une reprise. Les répétitions ordinaires du webhook et les doubles clics, eux, sont dédupliqués.

## Exploitation

Le cron quotidien existant conserve le nettoyage des commandes abandonnées et des photos, et supprime les sessions expirées. Les photos restent soumises à la rétention de 90 jours à partir de la création de commande. Les données de commande et de notification sont conservées pour l’exploitation ; leur durée administrative définitive reste à fixer.

La fabrication, l’impression et le dépôt postal restent manuels. Aucun transporteur ni imprimeur n’est connecté. L’avancement décrit les opérations enregistrées dans l’atelier, pas l’acheminement postal.

Une annulation, un remboursement, un changement d’adresse après paiement ou une correction d’expédition déjà confirmée nécessitent encore un traitement opérateur hors de cet écran. L’atelier ne doit pas être utilisé pour expédier une commande remboursée sans vérification.

Documentation officielle :

- [Email Sending](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [API Workers](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Restrictions du binding](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
