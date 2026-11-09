-- Kenshi Faction Hub — migration 011 : demandes d'adhésion (« Demander à rejoindre »).
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.

create table if not exists public.join_requests (
  id         bigint generated always as identity primary key,
  faction_id uuid not null references public.factions on delete cascade,
  profile_id uuid not null references public.profiles on delete cascade,
  message    text check (char_length(message) <= 300),
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now()
);
create unique index if not exists join_requests_one_pending
  on public.join_requests (faction_id, profile_id) where status = 'pending';
create index if not exists join_requests_faction_idx on public.join_requests (faction_id, status);

alter table public.join_requests enable row level security;
drop policy if exists join_read on public.join_requests;
create policy join_read on public.join_requests for select to authenticated
  using (profile_id = auth.uid() or (faction_id = public.my_faction() and public.is_manager()));

-- Demander : joueur sans faction, 5 demandes en attente au maximum.
create or replace function public.request_join(p_faction uuid, p_message text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare rid bigint;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.my_faction() is not null then raise exception 'already_in_faction'; end if;
  if not exists (select 1 from public.factions where id = p_faction and status = 'active') then
    raise exception 'faction_archived';
  end if;
  if (select count(*) from public.join_requests where profile_id = auth.uid() and status = 'pending') >= 5 then
    raise exception 'quota_join';
  end if;
  insert into public.join_requests (faction_id, profile_id, message)
  values (p_faction, auth.uid(), nullif(trim(p_message), ''))
  on conflict (faction_id, profile_id) where status = 'pending' do update set message = excluded.message
  returning id into rid;
  return rid;
end $$;

-- Répondre : Créateur, ou Chef en régime démocratique. Accepter = rôle « nouveau ».
create or replace function public.answer_join(p_request bigint, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.join_requests;
begin
  select * into r from public.join_requests where id = p_request and status = 'pending' for update;
  if r is null or r.faction_id is distinct from public.my_faction() or not public.is_manager() then
    raise exception 'not_allowed';
  end if;
  if p_accept then
    if exists (select 1 from public.memberships where profile_id = r.profile_id) then
      update public.join_requests set status = 'cancelled' where id = r.id;
      raise exception 'already_in_faction';
    end if;
    insert into public.memberships (profile_id, faction_id, role) values (r.profile_id, r.faction_id, 'nouveau');
    update public.join_requests set status = 'accepted' where id = r.id;
    -- ses autres demandes en attente n'ont plus d'objet
    update public.join_requests set status = 'cancelled'
      where profile_id = r.profile_id and status = 'pending' and id <> r.id;
  else
    update public.join_requests set status = 'declined' where id = r.id;
  end if;
end $$;

create or replace function public.cancel_join(p_request bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.join_requests set status = 'cancelled'
  where id = p_request and profile_id = auth.uid() and status = 'pending';
  if not found then raise exception 'not_allowed'; end if;
end $$;

-- Nettoyage (avec cleanup_old) : demandes traitées de plus de 30 jours.
create or replace function public.cleanup_old() returns void
language sql security definer set search_path = '' as $$
  delete from public.proposals where status <> 'open' and closes_at < now() - interval '90 days';
  delete from public.hire_requests where status in ('declined', 'cancelled') and created_at < now() - interval '30 days';
  delete from public.invites where expires_at < now() - interval '7 days';
  delete from public.join_requests where status <> 'pending' and created_at < now() - interval '30 days';
$$;
revoke execute on function public.cleanup_old from public, anon, authenticated;

revoke execute on function public.request_join, public.answer_join, public.cancel_join from public, anon;
grant execute on function public.request_join, public.answer_join, public.cancel_join to authenticated;
