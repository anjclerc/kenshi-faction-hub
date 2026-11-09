-- Kenshi Faction Hub — migration 015 : compte rendu de la dernière synchronisation du bot Discord.
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.
-- Écrit par la fonction « discord-bot » (clé de service), lu par les gestionnaires (même règle que faction_secrets).
alter table public.faction_secrets add column if not exists bot_status jsonb;
alter table public.faction_secrets add column if not exists bot_synced_at timestamptz;
