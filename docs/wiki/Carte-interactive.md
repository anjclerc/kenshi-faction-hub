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

## Ajouter une ville
1. Ouvre le site et **clique** à l'endroit de la ville : les coordonnées s'affichent.
2. Ajoute une entrée dans `data/towns.json` :
```json
{ "name": "The Hub", "faction": "—", "x": 1234, "y": 2345 }
```
3. Fais une Pull Request.

Source des noms : [Kenshi Wiki](https://kenshi.fandom.com) (CC BY-SA).
