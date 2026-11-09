-- Kenshi Faction Hub — migration 005 : diplomatie (alliés / neutres / ennemis) et partage des marqueurs entre alliés.
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.
--
-- Un « camp » est une faction ('f:<id>') ou un joueur indépendant ('p:<id>').
-- • Ennemi : déclaration unilatérale.
-- • Alliance : effective seulement si les deux camps se déclarent alliés (proposition puis acceptation).
-- • Partage : chaque camp choisit ce qu'il montre à chaque allié :
--   none (rien), main (base principale), bases (toutes les bases), all (tous les marqueurs).
--   En plus, un marqueur marqué « visible par nos alliés » est montré à tous les alliés.

create or replace function public.my_party() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce('f:' || public.my_faction()::text, 'p:' || auth.uid()::text)
$$;

-- Peut gérer la diplomatie : indépendant pour lui-même ; en faction : Créateur, Chef (démocratique), Diplomate.
create or replace function public.can_diplo() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_faction() is null or public.is_manager() or public.my_role() = 'diplomate'
$$;

create table if not exists public.relations (
  from_party text not null,
  to_party   text not null check (to_party ~ '^(f|p):[0-9a-f-]{36}$'),
  stance     text not null check (stance in ('ally', 'neutral', 'enemy')),
  share      text not null default 'none' check (share in ('none', 'main', 'bases', 'all')),
  updated_at timestamptz not null default now(),
  primary key (from_party, to_party),
  check (from_party <> to_party)
);
alter table public.relations enable row level security;
drop policy if exists relations_read on public.relations;
create policy relations_read on public.relations for select to authenticated
  using (from_party = public.my_party() or to_party = public.my_party());

create or replace function public.set_relation(p_to text, p_stance text, p_share text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me text := public.my_party();
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.can_diplo() then raise exception 'no_diplo_right'; end if;
  if p_to = me then raise exception 'not_allowed'; end if;
  insert into public.relations (from_party, to_party, stance, share)
  values (me, p_to, p_stance, coalesce(p_share, 'none'))
  on conflict (from_party, to_party) do update
    set stance = excluded.stance,
        share = coalesce(p_share, case when excluded.stance = 'ally' then public.relations.share else 'none' end),
        updated_at = now();
end $$;

-- Niveau de partage que le camp p_owner m'accorde (si l'alliance est réciproque), sinon null.
create or replace function public.ally_share(p_owner text) returns text
language sql stable security definer set search_path = '' as $$
  select r1.share from public.relations r1
  join public.relations r2 on r2.from_party = r1.to_party and r2.to_party = r1.from_party
  where r1.from_party = p_owner and r1.to_party = public.my_party()
    and r1.stance = 'ally' and r2.stance = 'ally'
$$;

-- Joueurs indépendants (pour proposer une alliance).
create or replace function public.list_independents()
returns table (id uuid, game_name text, discord_name text) language sql stable security definer set search_path = '' as $$
  select p.id, p.game_name, p.discord_name from public.profiles p
  where p.solo and p.game_name <> '' and not exists (select 1 from public.memberships m where m.profile_id = p.id)
  order by p.game_name
$$;

-- Nettoyage : une faction supprimée n'a plus de relations.
create or replace function public.cleanup_relations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.relations where from_party = 'f:' || old.id::text or to_party = 'f:' || old.id::text;
  return old;
end $$;
drop trigger if exists on_faction_deleted on public.factions;
create trigger on_faction_deleted after delete on public.factions
  for each row execute function public.cleanup_relations();

-- ───────────── Marqueurs : base principale + visibilité « alliés » ─────────────
alter table public.markers add column if not exists is_main boolean not null default false;
alter table public.markers drop constraint if exists markers_visibility_check;
alter table public.markers add constraint markers_visibility_check check (visibility in ('faction', 'allies', 'public'));

drop policy if exists markers_read on public.markers;
create policy markers_read on public.markers for select to anon, authenticated
  using (
    visibility = 'public'
    or faction_id = public.my_faction()
    or (faction_id is null and created_by = auth.uid())
    or (auth.uid() is not null and (
      with s as (select public.ally_share(coalesce('f:' || faction_id::text, 'p:' || created_by::text)) as lvl)
      select s.lvl is not null and (
        visibility = 'allies' or s.lvl = 'all'
        or (s.lvl = 'bases' and type = 'own_base')
        or (s.lvl = 'main' and type = 'own_base' and is_main))
      from s))
  );

revoke execute on function public.can_diplo, public.set_relation, public.list_independents from public, anon;
grant execute on function public.can_diplo, public.set_relation, public.list_independents to authenticated;
-- Utilisées par la règle de lecture des marqueurs (aussi évaluée pour les visiteurs) : sans risque, renvoient null.
grant execute on function public.my_party, public.ally_share to anon, authenticated;
