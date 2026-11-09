-- Kenshi Faction Hub — schéma Supabase (étape 2 : comptes, factions, rôles, invitations, marqueurs)
-- Une idée de Akumetsu, créée avec Claude.
-- À exécuter une fois dans Supabase > SQL Editor. Ré-exécutable (idempotent pour les fonctions/politiques).

create extension if not exists pgcrypto;

-- ───────────── Rôles disponibles ─────────────
-- createur, conseiller, architecte, diplomate, milicien, citoyen,
-- marchand, forgeron, fermier, mineur, medecin, eclaireur, nouveau (rôle d'intégration)

-- ───────────── Tables ─────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  game_name    text not null default '' check (char_length(game_name) <= 40),
  discord_name text,
  created_at   timestamptz not null default now()
);

create table if not exists public.game_name_history (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles on delete cascade,
  old_name   text not null,
  changed_at timestamptz not null default now()
);

create table if not exists public.factions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique check (char_length(name) between 2 and 40),
  color          text not null default '#c8a15a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  description    text check (char_length(description) <= 2000),
  discord_invite text check (discord_invite ~ '^https://(discord\.gg|discord\.com/invite)/'),
  governance     text not null default 'authoritarian' check (governance in ('authoritarian', 'democratic')),
  voting_roles   text[] not null default '{createur,conseiller,citoyen}',
  parent_id      uuid references public.factions on delete set null,  -- issue d'une scission
  status         text not null default 'active' check (status in ('active', 'archived')),
  created_by     uuid references public.profiles on delete set null,
  created_at     timestamptz not null default now()
);

create table if not exists public.memberships (
  profile_id uuid primary key references public.profiles on delete cascade,  -- une faction par joueur
  faction_id uuid not null references public.factions on delete cascade,
  role       text not null default 'nouveau' check (role in (
    'createur','conseiller','architecte','diplomate','milicien','citoyen',
    'marchand','forgeron','fermier','mineur','medecin','eclaireur','nouveau')),
  joined_at  timestamptz not null default now()
);
create index if not exists memberships_faction_idx on public.memberships (faction_id);

create table if not exists public.invites (
  code       text primary key default replace(replace(encode(gen_random_bytes(9), 'base64'), '/', '_'), '+', '-'),
  faction_id uuid not null references public.factions on delete cascade,
  created_by uuid not null references public.profiles on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  max_uses   int not null default 10 check (max_uses between 1 and 500),
  uses       int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.markers (
  id         bigint generated always as identity primary key,
  faction_id uuid not null references public.factions on delete cascade,
  created_by uuid not null references public.profiles on delete cascade,
  type       text not null check (type in ('own_base','allied_city','allied_base','enemy_base','loot','resource','danger','other')),
  name       text not null check (char_length(name) between 1 and 60),
  x          int not null check (x between 0 and 8192),
  y          int not null check (y between 0 and 8192),
  visibility text not null default 'faction' check (visibility in ('faction', 'public')),
  created_at timestamptz not null default now()
);

-- ───────────── Fonctions utilitaires ─────────────
create or replace function public.my_faction() returns uuid
language sql stable security definer set search_path = '' as $$
  select faction_id from public.memberships where profile_id = auth.uid()
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.memberships where profile_id = auth.uid()
$$;

-- Profil créé automatiquement à l'inscription (pseudo Discord repris de la connexion Discord).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, discord_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Historique des pseudos en jeu (mort, nouveau personnage).
create or replace function public.track_game_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.game_name <> '' and new.game_name is distinct from old.game_name then
    insert into public.game_name_history (profile_id, old_name) values (old.id, old.game_name);
  end if;
  return new;
end $$;
drop trigger if exists on_game_name_change on public.profiles;
create trigger on_game_name_change before update of game_name on public.profiles
  for each row execute function public.track_game_name();

-- ───────────── Actions (RPC) ─────────────
-- Créer une faction (le joueur en devient le Créateur). p_parent = faction d'origine en cas de scission.
create or replace function public.create_faction(p_name text, p_governance text default 'authoritarian', p_parent uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare fid uuid; prev uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  prev := public.my_faction();
  if prev is not null and prev is distinct from p_parent then raise exception 'already_in_faction'; end if;
  if prev is not null and public.my_role() = 'createur' then raise exception 'creator_must_transfer_first'; end if;
  delete from public.memberships where profile_id = auth.uid();  -- départ de la faction d'origine (scission)
  insert into public.factions (name, governance, parent_id, created_by)
    values (p_name, p_governance, p_parent, auth.uid()) returning id into fid;
  insert into public.memberships (profile_id, faction_id, role) values (auth.uid(), fid, 'createur');
  return fid;
end $$;

-- Générer un lien d'invitation (Créateur uniquement).
create or replace function public.create_invite(p_days int default 7, p_max_uses int default 10)
returns text language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if public.my_role() is distinct from 'createur' then raise exception 'creator_only'; end if;
  insert into public.invites (faction_id, created_by, expires_at, max_uses)
    values (public.my_faction(), auth.uid(), now() + make_interval(days => least(greatest(p_days, 1), 90)), p_max_uses)
    returning code into c;
  return c;
end $$;

-- Rejoindre une faction avec un lien d'invitation (rôle d'intégration « nouveau »).
create or replace function public.join_faction(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invites;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.my_faction() is not null then raise exception 'already_in_faction'; end if;
  select * into inv from public.invites where code = p_code for update;
  if inv is null or inv.expires_at < now() or inv.uses >= inv.max_uses then raise exception 'invalid_invite'; end if;
  if (select status from public.factions where id = inv.faction_id) <> 'active' then raise exception 'faction_archived'; end if;
  update public.invites set uses = uses + 1 where code = p_code;
  insert into public.memberships (profile_id, faction_id, role) values (auth.uid(), inv.faction_id, 'nouveau');
  return inv.faction_id;
end $$;

-- Quitter sa faction. Le Créateur doit d'abord transmettre son rôle, sauf s'il est seul (faction archivée).
create or replace function public.leave_faction()
returns void language plpgsql security definer set search_path = '' as $$
declare fid uuid := public.my_faction();
begin
  if fid is null then return; end if;
  if public.my_role() = 'createur' then
    if (select count(*) from public.memberships where faction_id = fid) > 1 then
      raise exception 'creator_must_transfer_first';
    end if;
    update public.factions set status = 'archived' where id = fid;
  end if;
  delete from public.memberships where profile_id = auth.uid();
end $$;

-- Changer le rôle d'un membre (Créateur uniquement). Donner « createur » = transfert (l'ancien devient citoyen).
create or replace function public.set_member_role(p_profile uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare fid uuid := public.my_faction();
begin
  if public.my_role() is distinct from 'createur' then raise exception 'creator_only'; end if;
  if p_profile = auth.uid() then raise exception 'cannot_change_own_role'; end if;
  if not exists (select 1 from public.memberships where profile_id = p_profile and faction_id = fid) then
    raise exception 'not_a_member';
  end if;
  update public.memberships set role = p_role where profile_id = p_profile;
  if p_role = 'createur' then
    update public.memberships set role = 'citoyen' where profile_id = auth.uid();
  end if;
end $$;

-- Exclure un membre (Créateur uniquement).
create or replace function public.kick_member(p_profile uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'createur' then raise exception 'creator_only'; end if;
  if p_profile = auth.uid() then raise exception 'use_leave_faction'; end if;
  delete from public.memberships where profile_id = p_profile and faction_id = public.my_faction();
end $$;

-- ───────────── Sécurité (Row Level Security) ─────────────
alter table public.profiles          enable row level security;
alter table public.game_name_history enable row level security;
alter table public.factions          enable row level security;
alter table public.memberships       enable row level security;
alter table public.invites           enable row level security;
alter table public.markers           enable row level security;

-- Profils : lisibles par les joueurs connectés ; chacun modifie le sien.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists history_read on public.game_name_history;
create policy history_read on public.game_name_history for select to authenticated using (true);

-- Factions : liste publique ; modifiables par leur Créateur.
drop policy if exists factions_read on public.factions;
create policy factions_read on public.factions for select to anon, authenticated using (true);
drop policy if exists factions_update on public.factions;
create policy factions_update on public.factions for update to authenticated
  using (id = public.my_faction() and public.my_role() = 'createur')
  with check (id = public.my_faction());

-- Membres : lisibles par les joueurs connectés (changements via les RPC).
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated using (true);

-- Invitations : visibles par le Créateur de la faction.
drop policy if exists invites_read on public.invites;
create policy invites_read on public.invites for select to authenticated
  using (faction_id = public.my_faction() and public.my_role() = 'createur');

-- Marqueurs : publics, ou réservés à la faction.
drop policy if exists markers_read on public.markers;
create policy markers_read on public.markers for select to anon, authenticated
  using (visibility = 'public' or faction_id = public.my_faction());
drop policy if exists markers_insert on public.markers;
create policy markers_insert on public.markers for insert to authenticated
  with check (faction_id = public.my_faction() and created_by = auth.uid() and public.my_role() <> 'nouveau');
drop policy if exists markers_delete on public.markers;
create policy markers_delete on public.markers for delete to authenticated
  using (faction_id = public.my_faction()
         and (created_by = auth.uid() or public.my_role() in ('createur', 'architecte')));

-- Seule la colonne game_name/discord_name du profil est modifiable directement.
revoke update on public.profiles from authenticated;
grant update (game_name, discord_name) on public.profiles to authenticated;
-- Factions : colonnes modifiables par le Créateur.
revoke update on public.factions from authenticated;
grant update (color, description, discord_invite, voting_roles) on public.factions to authenticated;

-- RPC : réservées aux joueurs connectés.
revoke execute on function public.create_faction, public.create_invite, public.join_faction,
  public.leave_faction, public.set_member_role, public.kick_member from public, anon;
grant execute on function public.create_faction, public.create_invite, public.join_faction,
  public.leave_faction, public.set_member_role, public.kick_member to authenticated;
