# Kenshi Faction Hub

> 🇫🇷 Gestion de factions pour **Kenshi multijoueur** : carte interactive, diplomatie, membres et rôles.
> 🇬🇧 Faction management for **multiplayer Kenshi**: interactive map, diplomacy, members and roles.

💡 **Une idée de Akumetsu, créée avec [Claude](https://claude.ai) (Anthropic).**
💡 **An idea by Akumetsu, built with [Claude](https://claude.ai) (Anthropic).**

---

## 🇫🇷 Français

### Objectif
Un site web pour les joueurs qui jouent à Kenshi en multijoueur, avec le mod [AnarchyKenshi](https://github.com/madscism-collab/AnarchyKenshi-Client).
- Gérer sa **faction** : nom, couleur, blason, bases, territoire.
- Gérer les **membres** avec des **rôles** : Créateur, Architecte, Milicien, Diplomate, Marchand, Forgeron, Fermier, Mineur, Médecin, Éclaireur, Recrue.
- Relier chaque joueur à son **pseudo en jeu** et son **pseudo Discord**, et afficher le **Discord de la faction**.
- Gérer la **diplomatie** : alliés (*white list*), neutres, ennemis (*black list*).
- Tout voir sur une **carte interactive** du monde de Kenshi.
- Site **multilingue** : français, anglais, russe.

### Feuille de route (MVP)
| # | Étape | Statut |
|---|---|---|
| 1 | Carte interactive (Leaflet) + 304 lieux du jeu + marqueurs + multilingue | ✅ |
| 2 | Comptes, factions, rôles (Supabase) + pseudo en jeu modifiable, pseudo Discord, Discord de la faction, invitation par lien | ⏳ |
| 3 | Diplomatie white/black list, couleurs sur la carte | ⏳ |
| 4 | Mise en ligne GitHub Pages | ⏳ |
| 5 | Intégration en jeu (selon l'accord de l'auteur d'AnarchyKenshi) | 💭 |

### Utiliser en jeu
Ouvre le site dans le **navigateur de l'overlay Steam** (`Maj` + `Tab`).

### Lancer en local
```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

### Documentation
Tout est dans le [Wiki](../../wiki) (copie dans [`docs/wiki/`](docs/wiki)).

---

## 🇬🇧 English

### Goal
A website for players running Kenshi in multiplayer with the [AnarchyKenshi](https://github.com/madscism-collab/AnarchyKenshi-Client) mod.
- Manage your **faction**: name, colour, banner, bases, territory.
- Manage **members** with **roles**: Founder, Architect, Militia, Diplomat, Trader, Smith, Farmer, Miner, Medic, Scout, Recruit.
- Link each player to their **in-game name** and **Discord name**, and show the **faction's Discord**.
- Handle **diplomacy**: allies (*white list*), neutral, enemies (*black list*).
- See everything on an **interactive map** of the Kenshi world.
- **Multilingual**: French, English, Russian.

### Roadmap (MVP)
| # | Step | Status |
|---|---|---|
| 1 | Interactive map (Leaflet) + 304 in-game places + markers + i18n | ✅ |
| 2 | Accounts, factions, roles (Supabase) + editable in-game name, Discord name, faction Discord, invite links | ⏳ |
| 3 | Diplomacy white/black list, colours on the map | ⏳ |
| 4 | Publish on GitHub Pages | ⏳ |
| 5 | In-game integration (depends on the AnarchyKenshi author) | 💭 |

### In game
Open the site in the **Steam overlay browser** (`Shift` + `Tab`).

### Run locally
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

### Docs
See the [Wiki](../../wiki) (mirror in [`docs/wiki/`](docs/wiki)).

---

## Crédits / Credits
- 💡 Idée / Idea: **Akumetsu**
- 🤖 Conçu avec / Built with: **Claude** (Anthropic)
- 🗺️ Moteur de carte / Map engine: [Leaflet](https://leafletjs.com) (BSD-2)
- 📚 Données des villes / Town data: [Kenshi Wiki](https://kenshi.fandom.com) (CC BY-SA)
- 🎮 *Kenshi* © Lo-Fi Games. Projet de fans non officiel, sans lien avec Lo-Fi Games. / Unofficial fan project, not affiliated with Lo-Fi Games.
