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

## Marqueurs des joueurs (`data/markers.json`)
Types : Notre base, Cité alliée, Base alliée, Base ennemie, Zone de loot, Ressources, Danger, Autre.

1. Dans le panneau **Ajouter un marqueur**, choisis le type et un nom.
2. Clique sur **Placer sur la carte**, puis sur l'endroit voulu.
3. Copie la ligne affichée dans `data/markers.json` et fais une Pull Request.

> À l'étape 2 (comptes), les marqueurs seront enregistrés en ligne directement, avec des droits selon le rôle.

## Territoires
L'**Architecte**, le **Créateur** ou le **Chef** (démocratique) : *Faction* → *Nos territoires* → nom → **Tracer sur la carte**, clique les coins (3 minimum), puis **Terminer**. 20 territoires maximum par faction.

Tout le monde voit les territoires ; l'apparence dépend de ta relation avec la faction :
| Relation | Apparence |
|---|---|
| Notre faction | Bleu |
| Alliée | Halo ambre chaleureux |
| Ennemie | Rouge hachuré, bordure qui pulse |
| Neutre | Gris en pointillés |
