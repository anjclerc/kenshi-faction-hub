-- Kenshi Faction Hub — migration 003 : une faction sans membre est supprimée (au lieu d'être archivée).
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.

-- Quitter : si le Créateur est le dernier membre, la faction est supprimée (marqueurs, votes, invitations compris).
create or replace function public.leave_faction()
returns void language plpgsql security definer set search_path = '' as $$
declare fid uuid := public.my_faction();
begin
  if fid is null then return; end if;
  if public.my_role() = 'createur' then
    if (select count(*) from public.memberships where faction_id = fid) > 1 then
      raise exception 'creator_must_transfer_first';
    end if;
    delete from public.factions where id = fid;   -- supprime aussi l'adhésion (cascade)
    return;
  end if;
  delete from public.memberships where profile_id = auth.uid();
end $$;

-- Dissolution adoptée par vote : la faction est supprimée.
create or replace function public.close_due_proposals()
returns int language plpgsql security definer set search_path = '' as $$
declare pr public.proposals; n int := 0; adopted boolean;
begin
  for pr in select * from public.proposals
            where faction_id = public.my_faction() and status = 'open' and closes_at <= now()
            order by closes_at for update
  loop
    adopted := pr.yes_count > pr.no_count;
    if adopted and pr.kind = 'dissolution' then
      delete from public.factions where id = pr.faction_id;
      return n + 1;
    end if;
    update public.proposals set status = case when adopted then 'passed' else 'rejected' end where id = pr.id;
    if adopted then
      if pr.kind = 'governance' then
        update public.factions
          set governance = case governance when 'authoritarian' then 'democratic' else 'authoritarian' end
          where id = pr.faction_id;
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

-- Factions déjà archivées (vides) : suppression.
delete from public.factions f
where f.status = 'archived' and not exists (select 1 from public.memberships m where m.faction_id = f.id);
