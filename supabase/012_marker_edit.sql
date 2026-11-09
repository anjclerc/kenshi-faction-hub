-- Kenshi Faction Hub — migration 012 : modifier un marqueur (nom, type, visibilité, base principale).
-- Mêmes droits que pour la suppression : l'auteur, ou Créateur / Chef / Architecte ; points de chute : leur auteur.
drop policy if exists markers_update on public.markers;
create policy markers_update on public.markers for update to authenticated
  using ((faction_id = public.my_faction()
          and (created_by = auth.uid() or public.my_role() in ('createur', 'chef', 'architecte')))
         or (faction_id is null and created_by = auth.uid()))
  with check ((faction_id = public.my_faction()) or (faction_id is null and created_by = auth.uid()));
revoke update on public.markers from authenticated;
grant update (name, type, visibility, is_main) on public.markers to authenticated;
