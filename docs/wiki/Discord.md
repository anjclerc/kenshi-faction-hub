# Discord

Le site se relie au Discord de la faction de deux façons, indépendantes l'une de l'autre. Les réglages sont dans **Gérer la faction** (Créateur, ou Chef en régime démocratique).

| | Annonces (webhook) | Bot Discord |
|---|---|---|
| Installation | Coller une adresse de webhook | Inviter le bot + coller le lien d'un salon |
| Nouveaux votes et raids | ✅ message | ✅ message avec boutons **Pour / Contre / Abstention** |
| Résultats des votes | ✅ | ✅ le message du vote est mis à jour |
| Nouveaux membres, demandes d'adhésion | ✅ | — |
| Rôles du site → rôles Discord | — | ✅ |
| Pseudo en jeu → surnom Discord | — | ✅ |

Aucune des deux ne mentionne jamais `@everyone`.

## Annonces (webhook)
1. Sur Discord : Paramètres du salon → **Intégrations** → **Webhooks** → Nouveau webhook → **Copier l'URL**.
2. Sur le site : Gérer la faction → **Annonces sur le Discord de la faction** → colle l'adresse → **Enregistrer**.
3. **Envoyer un message de test** pour vérifier.

Les heures des raids s'affichent dans le fuseau de chaque lecteur. L'adresse du webhook n'est visible que par les gestionnaires de la faction.

## Bot Discord
1. Gérer la faction → **Bot Discord** → **Inviter le bot** : choisis le serveur de la faction.
2. Sur Discord : Paramètres du serveur → **Rôles** → glisse le rôle **Kenshi Faction Hub** **au-dessus** des rôles qu'il doit gérer.
3. Clic droit sur un salon → **Copier le lien**, puis colle-le sur le site. Un salon **forum** est conseillé : chaque vote devient un fil.
4. Coche **Rôles** et/ou **Surnoms** → **Enregistrer** → **Synchroniser maintenant**.

Ce que fait le bot :
- **Rôles** : il crée les rôles de la faction dans la langue choisie pour les annonces (Chef, Citoyen, Nouveau venu…) et les attribue. Un changement de rôle sur le site est répercuté tout de suite ; un membre qui quitte la faction perd son rôle.
- **Surnoms** : le surnom Discord devient le pseudo en jeu, mis à jour quand il change.
- **Votes** : chaque vote est publié avec ses boutons. Le message affiche les totaux et la date de fin (ou l'heure du raid), puis le résultat. Le vote reste secret : seuls les totaux sont montrés.

Pour voter depuis Discord, il faut s'être connecté **une fois** au site avec le même compte Discord, et avoir le droit de vote dans la faction. Le bot répond en message visible par toi seul.

Limites :
- Le bot ne peut pas renommer le **propriétaire du serveur** (règle de Discord).
- Il ne touche qu'aux rôles qu'il a créés et aux membres qui se sont connectés au site.
- Le bouton **Synchroniser maintenant** remet tout d'aplomb (après avoir déplacé le rôle du bot, par exemple).

## Pour les administrateurs du site
Le bot tourne sur une **Supabase Edge Function** (`supabase/functions/discord-bot`) : rien à héberger, rien à laisser allumé. Installation sur un autre projet :
1. Appliquer `supabase/014_discord_bot.sql`.
2. Déployer la fonction `discord-bot`, avec la vérification JWT **désactivée** (Discord ne fournit pas de JWT). La fonction vérifie elle-même la signature Ed25519 de Discord, et la base l'appelle avec une clé interne générée dans `private.bot_key`.
3. Remplacer la clé publique Discord (`PUBLIC_KEY`) dans le code de la fonction et l'adresse de la fonction dans `bot_call` (migration 014).
4. Portail Discord → Bot → **Réinitialiser le token**, puis Supabase → Edge Functions → **Secrets** → `DISCORD_BOT_TOKEN`.
5. Portail Discord → Informations générales → **Interactions Endpoint URL** = adresse de la fonction.
