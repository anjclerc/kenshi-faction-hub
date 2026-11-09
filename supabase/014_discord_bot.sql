-- Kenshi Faction Hub — migration 014 : bot Discord (rôles + surnoms, votes avec boutons).
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.
-- La base prévient la fonction « discord-bot » (Supabase Edge Function) ; la fonction relit toujours
-- les vraies données avant d'agir, et refuse tout appel sans la clé interne (X-Bot-Key).

alter table public.faction_secrets add column if not exists discord_channel text
  check (discord_channel ~ '^https://((ptb|canary)\.)?discord(app)?\.com/channels/[0-9]+/[0-9]+$');
alter table public.faction_secrets add column if not exists role_map jsonb not null default '{}';
alter table public.faction_secrets add column if not exists sync_roles boolean not null default true;
alter table public.faction_secrets add column if not exists sync_nick boolean not null default true;
alter table public.proposals add column if not exists discord_message text;

-- Clé interne base → bot (générée ici, jamais exposée par l'API : schéma privé).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.bot_key (id int primary key default 1 check (id = 1),
  key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
alter table private.bot_key enable row level security;
insert into private.bot_key default values on conflict do nothing;

-- Vérification de la clé par la fonction (service role uniquement).
create or replace function public.bot_key_ok(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.bot_key where key = p)
$$;
revoke all on function public.bot_key_ok(text) from public, anon, authenticated;
grant execute on function public.bot_key_ok(text) to service_role;

-- Appel de la fonction du bot (asynchrone, via pg_net).
create or replace function public.bot_call(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://hccytdwfnfiraymeaxkr.supabase.co/functions/v1/discord-bot',
    body := p,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'X-Bot-Key', (select key from private.bot_key where id = 1)));
end $$;

create or replace function public.bot_enabled(p_faction uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.faction_secrets where faction_id = p_faction and discord_channel is not null)
$$;

create or replace function public.on_member_bot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare fid uuid := coalesce(new.faction_id, old.faction_id); pid uuid := coalesce(new.profile_id, old.profile_id);
begin
  if public.bot_enabled(fid) then
    perform public.bot_call(jsonb_build_object('type', 'member', 'profile_id', pid, 'faction_id', fid));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists bot_member on public.memberships;
create trigger bot_member after insert or delete or update of role on public.memberships
  for each row execute function public.on_member_bot();

create or replace function public.on_profile_bot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare fid uuid := (select faction_id from public.memberships where profile_id = new.id);
begin
  if fid is not null and public.bot_enabled(fid) then
    perform public.bot_call(jsonb_build_object('type', 'member', 'profile_id', new.id, 'faction_id', fid));
  end if;
  return new;
end $$;
drop trigger if exists bot_profile on public.profiles;
create trigger bot_profile after update of game_name on public.profiles
  for each row execute function public.on_profile_bot();

create or replace function public.on_proposal_bot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.bot_enabled(new.faction_id) then
    perform public.bot_call(jsonb_build_object('type', 'proposal', 'id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists bot_proposal on public.proposals;
create trigger bot_proposal after insert or update of yes_count, no_count, abstain_count, status on public.proposals
  for each row execute function public.on_proposal_bot();

create or replace function public.on_secrets_bot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.discord_channel is not null and (tg_op = 'INSERT' or new.discord_channel is distinct from old.discord_channel
     or new.sync_roles is distinct from old.sync_roles or new.sync_nick is distinct from old.sync_nick) then
    perform public.bot_call(jsonb_build_object('type', 'resync', 'faction_id', new.faction_id));
  end if;
  return new;
end $$;
drop trigger if exists bot_secrets on public.faction_secrets;
create trigger bot_secrets after insert or update on public.faction_secrets
  for each row execute function public.on_secrets_bot();

-- « Synchroniser maintenant » (gestionnaires).
create or replace function public.bot_resync() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'creator_only'; end if;
  perform public.bot_call(jsonb_build_object('type', 'resync', 'faction_id', public.my_faction()));
end $$;

-- ───── Fonctions réservées au bot (clé de service uniquement) ─────
create or replace function public.bot_discord_id(p_profile uuid) returns text
language sql stable security definer set search_path = '' as $$
  select provider_id from auth.identities where user_id = p_profile and provider = 'discord' limit 1
$$;
create or replace function public.bot_profile_by_discord(p_discord text) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from auth.identities where provider = 'discord' and provider_id = p_discord limit 1
$$;
-- Vote depuis Discord : mêmes règles que sur le site (droit de vote, vote ouvert…).
create or replace function public.cast_vote_as(p_profile uuid, p_proposal bigint, p_choice text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  perform public.cast_vote(p_proposal, p_choice);
end $$;

revoke execute on function public.bot_call, public.bot_enabled, public.on_member_bot, public.on_profile_bot,
  public.on_proposal_bot, public.on_secrets_bot, public.bot_discord_id, public.bot_profile_by_discord,
  public.cast_vote_as from public, anon, authenticated;
grant execute on function public.bot_discord_id, public.bot_profile_by_discord, public.cast_vote_as to service_role;
revoke execute on function public.bot_resync from public, anon;
grant execute on function public.bot_resync to authenticated;
grant update (discord_channel, sync_roles, sync_nick) on public.faction_secrets to authenticated;
