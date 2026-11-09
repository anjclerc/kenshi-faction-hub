-- Kenshi Faction Hub — migration 006 : garde-fous pour rester dans l'offre gratuite de Supabase.
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.
--
-- L'offre gratuite n'est jamais facturée, mais un dépassement (ex. base > 500 Mo) entraîne des restrictions.
-- • Disjoncteur global : au-delà de 400 Mo, les nouvelles écritures sont refusées (lecture toujours possible).
-- • Quotas par camp pour éviter les abus : marqueurs, votes, invitations, demandes de mercenaires.
-- • Nettoyage : vieilles propositions closes et demandes refusées/annulées supprimées.

create or replace function public.guard_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if pg_database_size(current_database()) > 400 * 1024 * 1024 then
    raise exception 'storage_full';
  end if;
  if tg_table_name = 'markers' then
    select count(*) into n from public.markers
      where (new.faction_id is not null and faction_id = new.faction_id)
         or (new.faction_id is null and faction_id is null and created_by = new.created_by);
    if n >= 500 then raise exception 'quota_markers'; end if;
  elsif tg_table_name = 'proposals' then
    select count(*) into n from public.proposals where faction_id = new.faction_id and status = 'open';
    if n >= 30 then raise exception 'quota_proposals'; end if;
  elsif tg_table_name = 'invites' then
    select count(*) into n from public.invites where faction_id = new.faction_id and expires_at > now();
    if n >= 50 then raise exception 'quota_invites'; end if;
  elsif tg_table_name = 'hire_requests' then
    select count(*) into n from public.hire_requests where requester_id = new.requester_id and status = 'pending';
    if n >= 20 then raise exception 'quota_hires'; end if;
  elsif tg_table_name = 'factions' then
    select count(*) into n from public.factions;
    if n >= 1000 then raise exception 'quota_factions'; end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['markers', 'proposals', 'invites', 'hire_requests', 'factions'] loop
    execute format('drop trigger if exists guard_quota on public.%I', t);
    execute format('create trigger guard_quota before insert on public.%I for each row execute function public.guard_quota()', t);
  end loop;
end $$;

-- Nettoyage automatique, déclenché à chaque visite (avec la clôture des votes) : pas de serveur à faire tourner.
create or replace function public.cleanup_old() returns void
language sql security definer set search_path = '' as $$
  delete from public.proposals where status <> 'open' and closes_at < now() - interval '90 days';
  delete from public.hire_requests where status in ('declined', 'cancelled') and created_at < now() - interval '30 days';
  delete from public.invites where expires_at < now() - interval '7 days';
$$;

create or replace function public.touch() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
  select public.cleanup_old();
$$;
