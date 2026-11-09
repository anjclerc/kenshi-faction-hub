-- Kenshi Faction Hub — migration 013 : annonces sur le Discord de la faction (webhook).
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.
-- Envoi fait par la base elle-même (extension pg_net) : aucun bot ni serveur à faire tourner.
-- L'adresse du webhook est privée : seuls les gestionnaires de la faction la voient.

create extension if not exists pg_net;

create table if not exists public.faction_secrets (
  faction_id      uuid primary key references public.factions on delete cascade,
  discord_webhook text check (discord_webhook ~ '^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$'),
  lang            text not null default 'fr' check (lang in ('fr', 'en', 'ru')),
  events          text[] not null default '{vote,result,member,join}',
  updated_at      timestamptz not null default now()
);
alter table public.faction_secrets enable row level security;
drop policy if exists secrets_manage on public.faction_secrets;
create policy secrets_manage on public.faction_secrets for all to authenticated
  using (faction_id = public.my_faction() and public.is_manager())
  with check (faction_id = public.my_faction() and public.is_manager());

-- Envoi d'un message (jamais de mention @everyone / @here / rôles / joueurs).
create or replace function public.notify_faction(p_faction uuid, p_event text, p_msg text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.faction_secrets;
begin
  select * into s from public.faction_secrets where faction_id = p_faction;
  if s.discord_webhook is null or not (p_event = 'test' or p_event = any (s.events)) then return; end if;
  perform net.http_post(
    url := s.discord_webhook,
    body := jsonb_build_object('content', left(p_msg, 1900),
                               'username', 'Kenshi Faction Hub',
                               'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
    headers := '{"Content-Type": "application/json"}'::jsonb);
end $$;

-- Petit dictionnaire des messages.
create or replace function public.notify_text(p_lang text, p_key text) returns text
language sql immutable set search_path = '' as $$
  select case p_lang
    when 'en' then case p_key
      when 'vote' then '🗳️ **New vote**: %s — closes <t:%s:R>'
      when 'raid' then '⚔️ **Raid proposed**: %s — on <t:%s:F> (your local time)'
      when 'passed' then '✅ **Vote passed**: %s (👍 %s · 👎 %s)'
      when 'rejected' then '❌ **Vote rejected**: %s (👍 %s · 👎 %s)'
      when 'member' then '👋 **%s** joined the faction.'
      when 'join' then '📨 **%s** asks to join the faction — answer on the site.'
      when 'test' then '✅ Kenshi Faction Hub is connected to this channel.' end
    when 'ru' then case p_key
      when 'vote' then '🗳️ **Новое голосование**: %s — закрытие <t:%s:R>'
      when 'raid' then '⚔️ **Предложен рейд**: %s — <t:%s:F> (ваше местное время)'
      when 'passed' then '✅ **Принято**: %s (👍 %s · 👎 %s)'
      when 'rejected' then '❌ **Отклонено**: %s (👍 %s · 👎 %s)'
      when 'member' then '👋 **%s** вступил во фракцию.'
      when 'join' then '📨 **%s** просится во фракцию — ответьте на сайте.'
      when 'test' then '✅ Kenshi Faction Hub подключён к этому каналу.' end
    else case p_key
      when 'vote' then '🗳️ **Nouveau vote** : %s — clôture <t:%s:R>'
      when 'raid' then '⚔️ **Raid proposé** : %s — le <t:%s:F> (ton heure locale)'
      when 'passed' then '✅ **Vote adopté** : %s (👍 %s · 👎 %s)'
      when 'rejected' then '❌ **Vote rejeté** : %s (👍 %s · 👎 %s)'
      when 'member' then '👋 **%s** a rejoint la faction.'
      when 'join' then '📨 **%s** demande à rejoindre la faction — réponds sur le site.'
      when 'test' then '✅ Kenshi Faction Hub est connecté à ce salon.' end
  end
$$;

create or replace function public.faction_lang(p_faction uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select lang from public.faction_secrets where faction_id = p_faction), 'fr')
$$;
-- Les noms saisis par les joueurs sont nettoyés (pas de mise en forme ni de mention possible).
create or replace function public.discord_safe(p text) returns text
language sql immutable set search_path = '' as $$
  select left(regexp_replace(coalesce(p, '?'), '[*_`~|>@#<]', '', 'g'), 120)
$$;

-- Déclencheurs
create or replace function public.on_proposal_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l text := public.faction_lang(new.faction_id);
begin
  if tg_op = 'INSERT' then
    if new.kind = 'raid' and new.event_at is not null then
      perform public.notify_faction(new.faction_id, 'vote',
        format(public.notify_text(l, 'raid'), public.discord_safe(new.title), extract(epoch from new.event_at)::bigint));
    else
      perform public.notify_faction(new.faction_id, 'vote',
        format(public.notify_text(l, 'vote'), public.discord_safe(new.title), extract(epoch from new.closes_at)::bigint));
    end if;
  elsif new.status in ('passed', 'rejected') and old.status = 'open' then
    perform public.notify_faction(new.faction_id, 'result',
      format(public.notify_text(l, new.status), public.discord_safe(new.title), new.yes_count, new.no_count));
  end if;
  return new;
end $$;
drop trigger if exists notify_proposal on public.proposals;
create trigger notify_proposal after insert or update of status on public.proposals
  for each row execute function public.on_proposal_event();

create or replace function public.on_member_joined() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role <> 'createur' then
    perform public.notify_faction(new.faction_id, 'member',
      format(public.notify_text(public.faction_lang(new.faction_id), 'member'),
             public.discord_safe((select coalesce(nullif(game_name, ''), discord_name) from public.profiles where id = new.profile_id))));
  end if;
  return new;
end $$;
drop trigger if exists notify_member on public.memberships;
create trigger notify_member after insert on public.memberships
  for each row execute function public.on_member_joined();

create or replace function public.on_join_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_faction(new.faction_id, 'join',
    format(public.notify_text(public.faction_lang(new.faction_id), 'join'),
           public.discord_safe((select coalesce(nullif(game_name, ''), discord_name) from public.profiles where id = new.profile_id))));
  return new;
end $$;
drop trigger if exists notify_join on public.join_requests;
create trigger notify_join after insert on public.join_requests
  for each row execute function public.on_join_request();

-- Message de test (gestionnaires).
create or replace function public.test_webhook() returns void
language plpgsql security definer set search_path = '' as $$
declare fid uuid := public.my_faction();
begin
  if not public.is_manager() then raise exception 'creator_only'; end if;
  perform public.notify_faction(fid, 'test', public.notify_text(public.faction_lang(fid), 'test'));
end $$;

revoke execute on function public.notify_faction, public.faction_lang, public.on_proposal_event,
  public.on_member_joined, public.on_join_request from public, anon, authenticated;
revoke execute on function public.test_webhook from public, anon;
grant execute on function public.test_webhook to authenticated;
