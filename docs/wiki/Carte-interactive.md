# Carte interactive

La carte utilise **Leaflet** en mode `CRS.Simple` : les coordonnées sont les **pixels de l'image 8192 × 8192** (`x` vers la droite, `y` vers le bas, origine en haut à gauche).

## Image de la carte
- Source : `data/gui/gfx/GUI_Map.dds` dans l'installation Kenshi (8192 × 8192 px).
- Découpée en tuiles (zoom 0 à 5) avec `tools/make_tiles.py` → `assets/map/tiles/`.
- Réglages dans `data/map.json`.

Autres sources possibles (couches alternatives) :
- **Nice Map [Zones + Zone names + Roads]** (Djeeshka) — l'auteur autorise les modifications avec mention.
- Political Map Redux, Better Map With Borders, In-Game Biome Map — **demander l'accord** de l'auteur avant publication.

> Les mods « map améliorée » sont uniquement des images : ils ne contiennent pas de coordonnées de villes.

## Lieux du jeu (`data/towns.json`)
**304 lieux** extraits directement des fichiers du jeu (positions exactes, noms identiques au wiki Fandom) avec `tools/extract_towns.py`.

| Calque | Contenu |
|---|---|
| Villes | Villes et avant-postes (The Hub, Squin, Admag, Heng…) |
| Villages | Villages (Hive, Holy Farm, Swamp…) |
| Ruines (loot) | Ruines, labos, armureries — zones intéressantes à piller |
| Camps | Camps de bandits, esclavagistes, tours |
| Forteresses | Forteresses (Okran's Shield, The Great Fortress…) |
| Nids (danger) | Nids de créatures (masqué par défaut) |

Conversion monde → carte : `pixel = (coordonnée monde + 147456) / 36` (monde de 64 zones × 4608 unités).

## Marqueurs des joueurs
Types : Notre base, Cité alliée, Base alliée, Base ennemie, Zone de loot, Ressources, Danger, Autre.

1. Connecte-toi. Dans le panneau **Ajouter un marqueur**, choisis le type, un nom et la visibilité (**ma faction**, **nos alliés** ou **tous**).
2. **Clique sur la carte** à l'endroit voulu : un cercle blanc en pointillés marque la position (clique ailleurs pour la changer).
3. Clique sur **📍 Placer le marqueur ici** : le marqueur est enregistré en ligne.

Clique sur un marqueur pour le **modifier** ✏️ ou le **supprimer** (auteur, Créateur, Chef, Architecte). Une case ★ **Base principale** sert au partage avec les alliés (voir [[Diplomatie|Diplomatie]]).

Sans compte, la carte affiche aussi les marqueurs publics de `data/markers.json` (ajouts possibles par Pull Request).

## Recherche
Le champ **🔍 Rechercher** trouve une ville, un marqueur ou un territoire et y déplace la carte. Sur téléphone, le bouton **☰ Calques** ouvre le panneau.

## Territoires
Le **Cartographe**, le **Créateur** ou le **Chef** (démocratique) : *Faction* → *Nos territoires* → nom, **type** et **visibilité** → **Tracer sur la carte**, clique les coins (3 minimum), puis **Terminer**. 20 territoires maximum par faction.

Types :
| Type | Usage |
|---|---|
| **À nous** | Zone contrôlée par la faction |
| **Alliée** | Zone d'un allié |
| **Neutre** | Zone partagée, sans conflit |
| **Danger** | Zone à éviter |

Visibilité : **ma faction**, **nos alliés** ou **tous**.

Apparence d'un territoire **« À nous »**, selon ta relation avec la faction qui l'a tracé :
| Relation | Apparence |
|---|---|
| Notre faction | Bleu |
| Alliée | Halo ambre chaleureux |
| Ennemie | Rouge hachuré, bordure qui pulse |
| Neutre | Gris en pointillés |

Les autres types gardent leur apparence : **Alliée** en ambre, **Neutre** en gris, **Danger** en violet pointillé qui pulse.
