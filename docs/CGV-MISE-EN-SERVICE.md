# CGV : décisions et contrôles avant mise en service

Le [projet de CGV](CGV-PROJET.md) est un document de préparation demandé par Alexandre Bescond le 14 novembre 2026. L’entreprise individuelle n’est pas encore créée. **Cette PR ne publie pas les CGV dans le site, ne change pas le checkout, ne fusionne aucune branche et n’autorise pas l’ouverture des ventes.**

## État vérifié du dépôt

Inspection de `main` au commit `05424c38524400a678d1f4b4c23b05197d3f6c59` :

- `src/lib/catalog.ts` : 1 à 5 cartes ; prix 7 / 12 / 16,50 / 21 / 25 € ; réduction groupée de 0,75 € par carte à partir de 2 ; cadence 7 jours.
- `src/lib/payments.ts` : destinations FR/BE/LU/CH, contrôle de zone ; Stripe ponctuel, promotions et confirmation par webhook. Le README indique encore France seule à certains endroits : **ne pas le prendre comme source unique**.
- `src/pages/personnaliser.astro` : acceptation commune CGV/confidentialité avant Stripe, pointant vers `/informations#conditions` encore provisoire.
- `src/lib/payments.ts` : `consent_version` contient actuellement `2026-11-02`. Cela ne démontre pas à lui seul l’archivage du texte accepté.
- `src/lib/email-templates.ts` : confirmation et suivi existent ; la remise de la version complète des CGV sur support durable doit être ajoutée/vérifiée.
- `src/pages/informations.astro` : vendeur, caractéristiques, délai du premier envoi, fiscalité et médiateur manquants. La confidentialité n’est pas définitive non plus.
- README : fabrication, impression et expédition manuelles. Aucun fournisseur IA ou imprimeur automatiquement connecté n’est établi par cette inspection.
- `.github/workflows/e2e.yml` : une PR vers `main` lance les vérifications ; le job de déploiement exclut les événements `pull_request`. Une **fusion dans `main` déploie le staging** ; une promotion `main` → `prod` peut déployer la production. Ne pas fusionner pour simplement montrer ce brouillon.

Ce sont des observations du code, **pas un test de la production ni de commandes réelles**.

## Informations à obtenir du propriétaire

- [ ] Après création : immatriculation exacte (SIREN/RNE/RCS selon l’activité), nom commercial confirmé, adresse de domiciliation à publier et adresse de retour.
- [ ] Courriel de service client opérationnel et téléphone. Aucune adresse privée trouvée ailleurs ne doit être publiée automatiquement dans ce dépôt public.
- [ ] Régime TVA réellement applicable, règles de facturation et éventuelle facturation transfrontalière.
- [ ] Format, papier, finition, conditionnement et contenu exact de la carte vendue.
- [ ] Processus réel de création (dont IA éventuelle), validation client/BAT éventuel, corrections incluses et prestataires impliqués.
- [ ] Délais maximaux de préparation et de livraison réalistes pour chaque pays et mode d’envoi ; service postal et suivi éventuel.
- [ ] Confirmer destinations FR/BE/LU/CH. Pour la Suisse, résoudre importation/TVA/frais de présentation, acteur payeur et information avant paiement. Vérifier les règles impératives locales en Belgique, Luxembourg et Suisse. Ne pas supprimer ces destinations sans décision du propriétaire.
- [ ] Choisir un médiateur compétent et adhérer réellement ; renseigner ses coordonnées et son site.
- [ ] Faire relire le texte final dans le cadre de l’activité et des destinations réellement ouvertes.

## Travail nécessaire avant ouverture publique

- [ ] Remplacer tous les `[À COMPLÉTER]` et `[À VÉRIFIER]`, retirer les notes éditoriales et fixer une date d’entrée en vigueur.
- [ ] Conserver et présenter visuellement l’encadré réglementaire intégral déjà inclus à l’article 9 (modèle A, vente de biens, annexe D. 211-2) lors de l’intégration dans le site ; recontrôler sa version à la date de publication. Il reste obligatoire pour des biens personnalisés.
- [ ] Publier une page accessible et imprimable de CGV définitives ; garder les versions historiques sans exposer les données des commandes.
- [ ] Afficher caractéristiques, prix total, territoire, délai de livraison et exception de rétractation **avant** paiement ; vérifier aussi l’intitulé du bouton de paiement Stripe.
- [ ] Conserver version et contenu exact des CGV acceptées avec chaque commande ; ne pas modifier seulement la constante `consent_version`.
- [ ] Remettre la confirmation et les CGV applicables par courriel ou document durable, pas uniquement un lien vers une page modifiable.
- [ ] Séparer l’acceptation contractuelle de l’information de confidentialité et d’un éventuel consentement marketing. Ne pas utiliser l’acceptation des CGV comme base universelle RGPD.
- [ ] Finaliser confidentialité et mentions légales, en incluant le processus manuel et les prestataires réellement utilisés pour la photo du compagnon/prénom de l’enfant.
- [ ] Vérifier remboursement, non-réception, défaut d’impression, demande de garantie, adresse erronée et commande partiellement expédiée. Ne pas imposer un délai de réclamation de 48 h ou un renoncement aux garanties.
- [ ] Si une offre non personnalisée ou numérique est ajoutée, revoir rétractation/formulaire et garanties avant de la vendre.
- [ ] Exécuter les contrôles techniques du README sur la version intégrée ; vérifier un checkout test, conservation de l’acceptation et remise du texte sans achat réel. Autorisation distincte pour publication, fusion ou déploiement.

## Sources officielles consultées le 14 novembre 2026

Ces références soutiennent le travail préparatoire, sans remplacer une vérification à la date de publication :

- [CGV consommateurs, Service-Public Entreprendre](https://entreprendre.service-public.gouv.fr/vosdroits/F33527).
- [Mentions légales du site professionnel, Service-Public Entreprendre](https://entreprendre.service-public.gouv.fr/vosdroits/F37351).
- [Médiation de la consommation, Service-Public Entreprendre](https://entreprendre.service-public.gouv.fr/vosdroits/F33338).
- [Exception de rétractation pour biens personnalisés, article L. 221-28](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170).
- [Encadré des garanties, article D. 211-2](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045987267/). [Modèle A intégral de l’annexe](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045981314) reproduit à l’article 9, y compris ses alinéas conditionnels numériques.
- [Livraison, obligations et recours, DGCCRF](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/livraison-quelles-sont-les-obligations-du-professionnel-et-les-recours).

Ne pas réintroduire l’ancien lien vers la plateforme européenne ODR/RLL, fermée le 20 juillet 2025. La médiation nationale reste à organiser.
