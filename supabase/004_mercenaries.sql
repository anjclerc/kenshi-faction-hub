-- Kenshi Faction Hub — migration 004 : rôles Chef / Élu / Mercenaire, activités de faction,
-- joueurs indépendants, points de chute personnels, pool de mercenaires et demandes d'aide.
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.

-- ───────────── Rôles ─────────────
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in (
  'createur', 'chef', 'elu', 'conseiller', 'architecte', 'diplomate', 'milicien', 'mercenaire', 'citoyen',
  'marchand', 'forgeron', 'fermier', 'mineur', 'medecin', 'eclaireur', 'nouveau'));
alter table public.factions alter column voting_roles set default '{createur,chef,elu,conseiller,citoyen}';

-- Activités de la faction (cumulables et modifiables à tout moment : PVP le matin, marchands le soir…).
alter table public.factions add column if not exists tags text[] not null default '{}';
grant update (tags) on public.factions to authenticated;

-- Gestionnaire : le Créateur ; en faction démocratique, le Chef aussi.
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.factions f on f.id = m.faction_id
    where m.profile_id = auth.uid()
      and (m.role = 'createur' or (m.role = 'chef' and f.governance = 'democratic')))
$$;

-- Peut engager un mercenaire : joueur sans faction, ou Créateur / Chef / Diplomate.
create or replace function public.can_hire() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_faction() is null or public.my_role() in ('createur', 'chef', 'diplomate')
$$;

drop policy if exists factions_update on public.factions;
create policy factions_update on public.factions for update to authenticated
  using (id = public.my_faction() and public.is_manager())
  with check (id = public.my_faction());

drop policy if exists invites_read on public.invites;
create policy invites_read on public.invites for select to authenticated
  using (faction_id = public.my_faction() and public.is_manager());

create or replace function public.create_invite(p_days int default 7, p_max_uses int default 10)
returns text language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not public.is_manager() then raise exception 'creator_only'; end if;
  insert into public.invites (faction_id, created_by, expires_at, max_uses)
    values (public.my_faction(), auth.uid(), now() + make_interval(days => least(greatest(p_days, 1), 90)), p_max_uses)
    returning code into c;
  return c;
end $$;

-- Rôles : le Créateur fait tout (y compris transmettre son rôle) ; le Chef (démocratique) gère les autres rôles.
create or replace function public.set_member_role(p_profile uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare fid uuid := public.my_faction(); target_role text;
begin
  if not public.is_manager() then raise exception 'creator_only'; end if;
  if p_profile = auth.uid() then raise exception 'cannot_change_own_role'; end if;
  select role into target_role from public.memberships where profile_id = p_profile and faction_id = fid;
  if target_role is null then raise exception 'not_a_member'; end if;
  if public.my_role() <> 'createur' and (target_role = 'createur' or p_role = 'createur') then
    raise exception 'creator_only';
  end if;
  update public.memberships set role = p_role where profile_id = p_profile;
  if p_role = 'createur' then
    update public.memberships set role = 'citoyen' where profile_id = auth.uid();
  end if;
end $$;

create or replace function public.kick_member(p_profile uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_manager() then raise exception 'creator_only'; end if;
  if p_profile = auth.uid() then raise exception 'use_leave_faction'; end if;
  delete from public.memberships
  where profile_id = p_profile and faction_id = public.my_faction() and role <> 'createur';
end $$;

-- ───────────── Joueurs indépendants ─────────────
alter table public.profiles add column if not exists solo boolean not null default false;
revoke update on public.profiles from authenticated;
grant update (game_name, discord_name, solo) on public.profiles to authenticated;

-- Points de chute personnels : marqueurs sans faction, visibles par leur seul auteur.
alter table public.markers alter column faction_id drop not null;

drop policy if exists markers_read on public.markers;
create policy markers_read on public.markers for select to anon, authenticated
  using (visibility = 'public'
         or faction_id = public.my_faction()
         or (faction_id is null and created_by = auth.uid()));
drop policy if exists markers_insert on public.markers;
create policy markers_insert on public.markers for insert to authenticated
  with check (created_by = auth.uid() and (
    (faction_id = public.my_faction() and public.my_role() <> 'nouveau')
    or (faction_id is null and public.my_faction() is null)));
drop policy if exists markers_delete on public.markers;
create policy markers_delete on public.markers for delete to authenticated
  using ((faction_id = public.my_faction()
          and (created_by = auth.uid() or public.my_role() in ('createur', 'chef', 'architecte')))
         or (faction_id is null and created_by = auth.uid()));

-- ───────────── Pool de mercenaires ─────────────
create table if not exists public.mercenaries (
  profile_id uuid primary key references public.profiles on delete cascade,
  available  boolean not null default true,
  skills     text check (char_length(skills) <= 500),    -- ex. : combat, escorte, minage…
  rates      text check (char_length(rates) <= 300),     -- tarifs
  region     text check (char_length(region) <= 100),    -- zone habituelle
  updated_at timestamptz not null default now()
);
alter table public.mercenaries enable row level security;
drop policy if exists mercenaries_read on public.mercenaries;
create policy mercenaries_read on public.mercenaries for select to authenticated using (true);
drop policy if exists mercenaries_insert on public.mercenaries;
create policy mercenaries_insert on public.mercenaries for insert to authenticated with check (profile_id = auth.uid());
drop policy if exists mercenaries_update on public.mercenaries;
create policy mercenaries_update on public.mercenaries for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists mercenaries_delete on public.mercenaries;
create policy mercenaries_delete on public.mercenaries for delete to authenticated using (profile_id = auth.uid());

create table if not exists public.hire_requests (
  id            bigint generated always as identity primary key,
  mercenary_id  uuid not null references public.profiles on delete cascade,
  requester_id  uuid not null references public.profiles on delete cascade,
  faction_id    uuid references public.factions on delete cascade,   -- null : demande d'un joueur seul
  mission       text not null check (char_length(mission) between 3 and 1000),
  reward        text check (char_length(reward) <= 200),
  event_at      timestamptz,
  target_x      int check (target_x between 0 and 8192),
  target_y      int check (target_y between 0 and 8192),
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at    timestamptz not null default now()
);
alter table public.hire_requests enable row level security;
drop policy if exists hire_read on public.hire_requests;
create policy hire_read on public.hire_requests for select to authenticated
  using (mercenary_id = auth.uid() or requester_id = auth.uid()
         or (faction_id = public.my_faction() and public.my_role() in ('createur', 'chef', 'diplomate')));

create or replace function public.request_hire(p_mercenary uuid, p_mission text, p_reward text default null,
  p_event_at timestamptz default null, p_x int default null, p_y int default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.can_hire() then raise exception 'cannot_hire'; end if;
  if p_mercenary = auth.uid() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.mercenaries where profile_id = p_mercenary and available) then
    raise exception 'mercenary_unavailable';
  end if;
  insert into public.hire_requests (mercenary_id, requester_id, faction_id, mission, reward, event_at, target_x, target_y)
  values (p_mercenary, auth.uid(), public.my_faction(), p_mission, nullif(p_reward, ''), p_event_at, p_x, p_y)
  returning id into rid;
  return rid;
end $$;

-- Le mercenaire accepte ou refuse ; le demandeur peut annuler.
create or replace function public.answer_hire(p_request bigint, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status in ('accepted', 'declined') then
    update public.hire_requests set status = p_status
    where id = p_request and mercenary_id = auth.uid() and status = 'pending';
  elsif p_status = 'cancelled' then
    update public.hire_requests set status = 'cancelled'
    where id = p_request and status in ('pending', 'accepted')
      and (requester_id = auth.uid()
           or (faction_id = public.my_faction() and public.my_role() in ('createur', 'chef', 'diplomate')));
  end if;
  if not found then raise exception 'not_allowed'; end if;
end $$;

revoke execute on function public.is_manager, public.can_hire, public.request_hire, public.answer_hire from public, anon;
grant execute on function public.is_manager, public.can_hire, public.request_hire, public.answer_hire to authenticated;
