-- Kenshi Faction Hub — migration 002 : votes (à exécuter après schema.sql). Ré-exécutable.
-- Une idée de Akumetsu, créée avec Claude.
--
-- Règles :
--  • Votent les membres dont le rôle est dans factions.voting_roles (choisi par le chef).
--  • Vote secret : chacun ne voit que son propre vote ; les totaux sont publics dans la faction.
--  • Adoptée si « Pour » > « Contre » à la clôture (durée : factions.vote_hours, 48 h par défaut).
--  • Faction autoritaire : votes général / ressources / raid = consultatifs (le Créateur décide).
--    Toujours appliqués : changement de type, dissolution, destitution du chef inactif.

alter table public.profiles add column if not exists last_seen_at timestamptz not null default now();
alter table public.factions add column if not exists vote_hours int not null default 48 check (vote_hours between 1 and 336);
alter table public.factions add column if not exists inactivity_days int not null default 14 check (inactivity_days between 3 and 90);

create table if not exists public.proposals (
  id             bigint generated always as identity primary key,
  faction_id     uuid not null references public.factions on delete cascade,
  created_by     uuid references public.profiles on delete set null,
  kind           text not null check (kind in ('general', 'resources', 'raid', 'governance', 'dissolution', 'depose')),
  title          text not null check (char_length(title) between 3 and 120),
  description    text check (char_length(description) <= 4000),
  event_at       timestamptz,                                   -- raid : date et heure
  target_x       int check (target_x between 0 and 8192),       -- raid : cible sur la carte
  target_y       int check (target_y between 0 and 8192),
  target_profile uuid references public.profiles on delete set null,  -- destitution : nouveau chef proposé
  closes_at      timestamptz not null,
  status         text not null default 'open' check (status in ('open', 'passed', 'rejected', 'cancelled')),
  yes_count      int not null default 0,
  no_count       int not null default 0,
  abstain_count  int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists proposals_faction_idx on public.proposals (faction_id, status);

create table if not exists public.votes (
  proposal_id bigint not null references public.proposals on delete cascade,
  profile_id  uuid not null references public.profiles on delete cascade,
  choice      text not null check (choice in ('yes', 'no', 'abstain')),
  voted_at    timestamptz not null default now(),
  primary key (proposal_id, profile_id)
);

-- ───────────── Fonctions ─────────────
create or replace function public.can_vote() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.factions f on f.id = m.faction_id
    where m.profile_id = auth.uid() and f.status = 'active' and m.role = any (f.voting_roles))
$$;

-- Dernière activité (appelée à chaque visite du site) : sert à détecter un chef inactif.
create or replace function public.touch() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now() where id = auth.uid()
$$;

create or replace function public.create_proposal(
  p_kind text, p_title text, p_description text default null,
  p_event_at timestamptz default null, p_x int default null, p_y int default null, p_target uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  fid uuid := public.my_faction();
  f public.factions;
  lead_seen timestamptz;
  pid bigint;
begin
  if fid is null then raise exception 'not_in_faction'; end if;
  if not public.can_vote() then raise exception 'no_vote_right'; end if;
  select * into f from public.factions where id = fid;
  if p_kind in ('governance', 'dissolution', 'depose')
     and exists (select 1 from public.proposals where faction_id = fid and kind = p_kind and status = 'open') then
    raise exception 'already_open';
  end if;
  if p_kind = 'depose' then
    select p.last_seen_at into lead_seen
      from public.memberships m join public.profiles p on p.id = m.profile_id
      where m.faction_id = fid and m.role = 'createur';
    if lead_seen > now() - make_interval(days => f.inactivity_days) then raise exception 'leader_active'; end if;
    if p_target is null or not exists (
      select 1 from public.memberships where profile_id = p_target and faction_id = fid and role <> 'createur') then
      raise exception 'invalid_candidate';
    end if;
  end if;
  if p_kind = 'raid' and p_event_at is null then raise exception 'raid_needs_date'; end if;

  insert into public.proposals (faction_id, created_by, kind, title, description, event_at,
                                target_x, target_y, target_profile, closes_at)
  values (fid, auth.uid(), p_kind, p_title, nullif(p_description, ''), p_event_at,
          p_x, p_y, case when p_kind = 'depose' then p_target end, now() + make_interval(hours => f.vote_hours))
  returning id into pid;
  return pid;
end $$;

create or replace function public.cast_vote(p_proposal bigint, p_choice text)
returns void language plpgsql security definer set search_path = '' as $$
declare pr public.proposals;
begin
  select * into pr from public.proposals where id = p_proposal for update;
  if pr is null or pr.faction_id is distinct from public.my_faction() then raise exception 'not_found'; end if;
  if pr.status <> 'open' or pr.closes_at <= now() then raise exception 'vote_closed'; end if;
  if not public.can_vote() then raise exception 'no_vote_right'; end if;
  insert into public.votes (proposal_id, profile_id, choice) values (p_proposal, auth.uid(), p_choice)
    on conflict (proposal_id, profile_id) do update set choice = excluded.choice, voted_at = now();
  update public.proposals set
    yes_count     = (select count(*) from public.votes where proposal_id = p_proposal and choice = 'yes'),
    no_count      = (select count(*) from public.votes where proposal_id = p_proposal and choice = 'no'),
    abstain_count = (select count(*) from public.votes where proposal_id = p_proposal and choice = 'abstain')
  where id = p_proposal;
end $$;

-- Annuler : l'auteur de la proposition ou le Créateur.
create or replace function public.cancel_proposal(p_proposal bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.proposals set status = 'cancelled'
  where id = p_proposal and status = 'open' and faction_id = public.my_faction()
    and (created_by = auth.uid() or public.my_role() = 'createur');
  if not found then raise exception 'not_allowed'; end if;
end $$;

-- Clôture des votes arrivés à échéance (appelée à chaque visite : pas besoin de serveur qui tourne).
create or replace function public.close_due_proposals()
returns int language plpgsql security definer set search_path = '' as $$
declare pr public.proposals; n int := 0; adopted boolean;
begin
  for pr in select * from public.proposals
            where faction_id = public.my_faction() and status = 'open' and closes_at <= now()
            order by closes_at for update
  loop
    adopted := pr.yes_count > pr.no_count;
    update public.proposals set status = case when adopted then 'passed' else 'rejected' end where id = pr.id;
    if adopted then
      if pr.kind = 'governance' then
        update public.factions
          set governance = case governance when 'authoritarian' then 'democratic' else 'authoritarian' end
          where id = pr.faction_id;
      elsif pr.kind = 'dissolution' then
        update public.factions set status = 'archived' where id = pr.faction_id;
        delete from public.memberships where faction_id = pr.faction_id;
        exit;  -- plus de faction : on s'arrête là
      elsif pr.kind = 'depose' and exists (
        select 1 from public.memberships where profile_id = pr.target_profile and faction_id = pr.faction_id) then
        update public.memberships set role = 'citoyen' where faction_id = pr.faction_id and role = 'createur';
        update public.memberships set role = 'createur' where profile_id = pr.target_profile;
      end if;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────── Sécurité ─────────────
alter table public.proposals enable row level security;
alter table public.votes     enable row level security;

drop policy if exists proposals_read on public.proposals;
create policy proposals_read on public.proposals for select to authenticated
  using (faction_id = public.my_faction());
drop policy if exists votes_read_own on public.votes;
create policy votes_read_own on public.votes for select to authenticated
  using (profile_id = auth.uid());

-- Réglages de vote modifiables par le Créateur (avec la politique factions_update existante).
grant update (vote_hours, inactivity_days) on public.factions to authenticated;

revoke execute on function public.touch, public.create_proposal, public.cast_vote,
  public.cancel_proposal, public.close_due_proposals, public.can_vote from public, anon;
grant execute on function public.touch, public.create_proposal, public.cast_vote,
  public.cancel_proposal, public.close_due_proposals, public.can_vote to authenticated;
