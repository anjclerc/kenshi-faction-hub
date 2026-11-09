# Kenshi Faction Hub

> 🇫🇷 Gestion de factions pour **Kenshi multijoueur** : carte interactive, diplomatie, membres et rôles.
> 🇬🇧 Faction management for **multiplayer Kenshi**: interactive map, diplomacy, members and roles.

💡 **Une idée de Akumetsu, créée avec [Claude](https://claude.ai) (Anthropic).**
💡 **An idea by Akumetsu, built with [Claude](https://claude.ai) (Anthropic).**

---

## 🇫🇷 Français

### Objectif
Un site web pour les joueurs qui jouent à Kenshi en multijoueur, avec le mod [AnarchyKenshi](https://github.com/madscism-collab/AnarchyKenshi-Client).

👉 **En ligne : https://anjclerc.github.io/kenshi-faction-hub/**

- **Carte interactive** du monde de Kenshi : 304 lieux du jeu, recherche, marqueurs partagés, **territoires** (à nous, alliés, neutres, danger).
- **Factions** autoritaires ou démocratiques : invitations par lien, demandes d'adhésion, scission, dissolution.
- **Rôles** : Créateur, Chef, Élu, Conseiller, Architecte, Cartographe, Diplomate, Milicien, Mercenaire, Citoyen, métiers, Nouveau venu.
- **Votes** : propositions, ressources, **raids** (date, heure, cible sur la carte), destitution d'un chef inactif.
- **Diplomatie** : alliances réciproques avec partage des marqueurs, ennemis, neutres.
- **Mercenaires** : pool de joueurs à engager, demandes d'aide, jeu **en indépendant**.
- **Discord** : connexion avec Discord, **annonces** automatiques (webhook) et **bot** (rôles, surnoms = pseudo en jeu, votes par boutons).
- **Multilingue** : français, anglais, russe. Fonctionne sur téléphone.

### Feuille de route
| # | Étape | Statut |
|---|---|---|
| 1 | Carte interactive + 304 lieux + recherche + multilingue | ✅ |
| 2 | Comptes Discord, factions, rôles, invitations, demandes d'adhésion, votes | ✅ |
| 3 | Diplomatie, mercenaires, territoires | ✅ |
| 4 | Mise en ligne GitHub Pages | ✅ |
| 5 | Discord : annonces (webhook) et bot | ✅ |
| 6 | Intégration en jeu (selon l'accord de l'auteur d'AnarchyKenshi) | 💭 |

### Héberger sa propre copie (Supabase, offre gratuite)
1. Exécuter dans *SQL Editor*, dans l'ordre : `supabase/schema.sql`, puis `supabase/002_votes.sql` → `supabase/015_bot_status.sql` (ordre des numéros).
2. Mettre l'adresse et la clé publique du projet dans `assets/js/config.js`.
3. Activer la connexion **Discord** dans Supabase (Authentication → Providers).
4. Bot Discord (facultatif) : déployer `supabase/functions/discord-bot` — voir la page [Discord du wiki](../../wiki/Discord).

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

👉 **Live: https://anjclerc.github.io/kenshi-faction-hub/**

- **Interactive map** of the Kenshi world: 304 in-game places, search, shared markers, **territories** (ours, allied, neutral, danger).
- **Factions**, authoritarian or democratic: invite links, join requests, split, dissolution.
- **Roles**: Founder, Chief, Elected, Councillor, Architect, Cartographer, Diplomat, Militia, Mercenary, Citizen, trades, Newcomer.
- **Votes**: proposals, resources, **raids** (date, time, target on the map), removing an inactive chief.
- **Diplomacy**: mutual alliances with marker sharing, enemies, neutral.
- **Mercenaries**: pool of players for hire, help requests, **independent** play.
- **Discord**: Discord sign-in, automatic **announcements** (webhook) and a **bot** (roles, nicknames = in-game name, button votes).
- **Multilingual**: French, English, Russian. Works on phones.

### Roadmap
| # | Step | Status |
|---|---|---|
| 1 | Interactive map + 304 places + search + i18n | ✅ |
| 2 | Discord accounts, factions, roles, invites, join requests, votes | ✅ |
| 3 | Diplomacy, mercenaries, territories | ✅ |
| 4 | Published on GitHub Pages | ✅ |
| 5 | Discord: announcements (webhook) and bot | ✅ |
| 6 | In-game integration (depends on the AnarchyKenshi author) | 💭 |

### Host your own copy (Supabase free tier)
1. Run in *SQL Editor*, in order: `supabase/schema.sql`, then `supabase/002_votes.sql` → `supabase/015_bot_status.sql` (by number).
2. Put the project URL and publishable key in `assets/js/config.js`.
3. Enable the **Discord** provider in Supabase (Authentication → Providers).
4. Discord bot (optional): deploy `supabase/functions/discord-bot` — see the wiki [Discord page](../../wiki/Discord) (French).

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

## Bugs & idées / Bugs & ideas
🐞 [Signaler un bug / Report a bug](../../issues/new?template=bug_report.yml) · 💡 [Proposer une idée / Suggest an idea](../../issues/new?template=feature_request.yml)

## Crédits / Credits
- 💡 Idée / Idea: **Akumetsu**
- 🤖 Conçu avec / Built with: **Claude** (Anthropic)
- 🗺️ Moteur de carte / Map engine: [Leaflet](https://leafletjs.com) (BSD-2)
- 📚 Données des villes / Town data: [Kenshi Wiki](https://kenshi.fandom.com) (CC BY-SA)
- 🎮 *Kenshi* © Lo-Fi Games. Projet de fans non officiel, sans lien avec Lo-Fi Games. / Unofficial fan project, not affiliated with Lo-Fi Games.
