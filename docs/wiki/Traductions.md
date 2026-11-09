# Traductions

Les textes sont dans `i18n/<langue>.json` (`fr`, `en`, `ru`).

## Ajouter une langue
1. Copie `i18n/en.json` vers `i18n/<code>.json` (ex. `de.json`).
2. Traduis les valeurs (pas les clés).
3. Ajoute `<option value="de">Deutsch</option>` dans `index.html`.
4. Ajoute le code dans la liste de `assets/js/i18n.js` (`['fr', 'en', 'ru', 'de']`).
5. Messages Discord (facultatif) : ajouter la langue dans `notify_text` et la contrainte `lang` (`supabase/013_discord_webhook.sql`), et dans `ROLE_NAMES` / `T` / `ERR` de `supabase/functions/discord-bot/index.ts`.
