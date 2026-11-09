-- Kenshi Faction Hub — migration 010 : durcissement et optimisation (revue du 9 nov. 2026).
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.

-- 1. Fonctions internes : plus appelables directement par les visiteurs / joueurs.
--    (les déclencheurs et la fonction touch() les exécutent toujours avec les droits du propriétaire)
revoke execute on function public.handle_new_user, public.track_game_name, public.guard_quota,
  public.guard_territories, public.cleanup_relations, public.cleanup_old from public, anon, authenticated;
--    Aides de droits : réservées aux joueurs connectés.
revoke execute on function public.my_role, public.is_manager, public.can_hire, public.can_draw,
  public.can_diplo, public.can_vote from public, anon;
grant execute on function public.my_role, public.is_manager, public.can_hire, public.can_draw,
  public.can_diplo, public.can_vote to authenticated;
--    Restent ouvertes aux visiteurs (utilisées par les règles de lecture, renvoient null) :
--    my_faction, my_party, ally_share ; et invite_info (écran d'invitation).

-- 2. Territoires : taille des coordonnées bornée (évite qu'on remplisse la base avec un énorme objet).
alter table public.territories drop constraint if exists territories_points_size;
alter table public.territories add constraint territories_points_size check (pg_column_size(points) < 4000);

-- 3. Index pour les lectures fréquentes.
create index if not exists markers_faction_idx      on public.markers (faction_id);
create index if not exists markers_creator_idx      on public.markers (created_by) where faction_id is null;
create index if not exists territories_faction_idx  on public.territories (faction_id);
create index if not exists relations_to_idx         on public.relations (to_party);
create index if not exists hire_merc_idx            on public.hire_requests (mercenary_id);
create index if not exists hire_requester_idx       on public.hire_requests (requester_id);
create index if not exists votes_profile_idx        on public.votes (profile_id);

-- 4. Nettoyage : une visite sur dix suffit (moins de travail à chaque chargement).
create or replace function public.touch() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set last_seen_at = now() where id = auth.uid();
  if random() < 0.1 then perform public.cleanup_old(); end if;
end $$;
revoke execute on function public.touch from public, anon;
grant execute on function public.touch to authenticated;
