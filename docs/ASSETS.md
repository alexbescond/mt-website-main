# Images du site

Les dix images tropicales ont été fournies par l’utilisateur dans cette conversation. Elles ont été converties en WebP de 1200 px (qualité 82) et sont conservées dans `public/images/`. Les originaux restent dans `.context/attachments/` et ne sont pas versionnés.

| Image | Utilisation |
| --- | --- |
| `tetine-transat.webp` | Carte tropicale, personnalisation |
| `tetine-hamac.webp` | Histoire du projet, carte d’exemple |
| `tetine-paddle.webp` | Galerie et extrait |
| `tetine-plongee.webp` | Extrait |
| `tetine-chateau.webp` | Galerie |
| `tetine-avion.webp` | Galerie et extrait |
| `tetine-ile.webp` | Extrait |
| `tetine-enregistrement.webp` | Extrait |
| `tetine-embarquement.webp`, `tetine-arrivee.webp` | Images disponibles pour illustrer d’autres cartes |
| `tetine-ski.webp` | Carte ski, personnalisation et extrait |

Le visuel `public/images/tetine-ski.webp` a été créé avec l’outil intégré ImageGen, avec la photo de la tétine sur son transat comme référence. Les premières propositions sans référence ont été écartées après réception des images de l’utilisateur.

Prompt de génération retenu :

> Use case: illustration-story. Create a new winter vacation scene using the attached image as a character and style reference. Preserve the exact recognizable plum pacifier design: rounded butterfly plum-purple plastic shield with small ventilation holes, cream central dome with tiny worn gold motifs, small plum arms and legs, no human face. The same pacifier is happily skiing on miniature wooden skis on a beautiful snowy alpine slope, wearing a cream knitted hat and a muted coral scarf, holding ski poles with little plum hands. Snow-dusted fir trees and majestic mountain peaks, blue sky, warm sunlight, detailed realistic miniature photography with tactile textures. Keep the character proportions, worn dome and plum color very close to the reference. Landscape 3:2 composition, subject near center lower half. No text, no watermark, no humans.

Ces images sont des exemples de présentation. La version actuelle du site ne génère pas automatiquement les images ou les cartes des clients.

## Illustration commune doudou et tétine

`public/images/compagnons-voyage.webp` a été créée avec l’outil intégré ImageGen le 21 octobre 2026, puis optimisée en WebP (1536 × 1024, qualité 86). Elle sert à l’accueil, à la page de présentation et au partage social. Elle illustre l’univers de marque avec des personnages fictifs ; ce n’est pas une commande client ni une validation de la charte des cartes.

Prompt : illustration jeunesse 3D chaleureuse, tactile et cinématographique ; doudou lapin beige au foulard sauge et sac rouille, tétine prune expressive aux petits bras et jambes crème ; tous deux regardent une carte illustrée sans texte sur un ponton au bord d’un lagon turquoise. Petite valise, île tropicale, palmiers, sable clair et bungalow au loin. Lumière douce du matin, palette crème, sauge, corail et turquoise. Composition paysage 3:2, personnages centraux, espace autour pour le recadrage mobile. Aucun enfant, texte, logo ou filigrane.

## Aperçus des cartes postales

Les composants `Postcard.astro` et `PostcardPreview.astro` présentent les illustrations existantes dans une maquette HTML/CSS de carte recto-verso, avec papier, petit mot fictif, zone destinataire et timbre décoratif. La maquette elle-même ne nécessite pas de nouvel asset raster. Les onze aventures ont chacune une illustration d’exemple pour Tétine et une pour Doudou. Les illustrations d’exemple ne sont pas remplacées par la photo téléversée : celle-ci sert de référence pour la fabrication ultérieure.

## Variantes Doudou

Cinq scènes Doudou (transat, ski, plongée, avion et enregistrement) sont disponibles dans `public/images/doudou-*.webp`. Le formulaire affiche une illustration par carte choisie, selon le compagnon et chaque aventure, dans l’ordre des envois. Les prompts et les fichiers sont documentés dans [DOUDOU_IMAGES.md](DOUDOU_IMAGES.md).

## Safari, bateau pirate, pelleteuse, circuit, espace et Noël

Les douze nouveaux fichiers `public/images/{tetine,doudou}-{safari,bateau,pelleteuse,circuit,espace,noel}.webp` sont documentés avec leurs prompts dans [ADVENTURE_IMAGES.md](ADVENTURE_IMAGES.md). Les variantes Tétine et Doudou apparaissent dans le catalogue, les menus de commande et le récapitulatif visuel du lot.
