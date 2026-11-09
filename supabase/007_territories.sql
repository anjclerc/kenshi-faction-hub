-- Kenshi Faction Hub — migration 007 : territoires de faction (zones dessinées sur la carte).
-- Une idée de Akumetsu, créée avec Claude. Ré-exécutable.
-- Visibles par tous (une revendication se voit) ; l'apparence dépend de la relation avec la faction qui regarde.

create table if not exists public.territories (
  id         bigint generated always as identity primary key,
  faction_id uuid not null references public.factions on delete cascade,
  created_by uuid references public.profiles on delete set null,
  name       text not null check (char_length(name) between 1 and 60),
  points     jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 3 and 100),
  created_at timestamptz not null default now()
);
alter table public.territories enable row level security;

-- Peut tracer : Créateur, Chef (démocratique) ou Architecte.
create or replace function public.can_draw() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_manager() or public.my_role() = 'architecte'
$$;

drop policy if exists territories_read on public.territories;
create policy territories_read on public.territories for select to anon, authenticated using (true);
drop policy if exists territories_insert on public.territories;
create policy territories_insert on public.territories for insert to authenticated
  with check (faction_id = public.my_faction() and created_by = auth.uid() and public.can_draw());
drop policy if exists territories_delete on public.territories;
create policy territories_delete on public.territories for delete to authenticated
  using (faction_id = public.my_faction() and public.can_draw());

-- Quota : 20 territoires par faction (+ disjoncteur global de 006).
create or replace function public.guard_territories() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_database_size(current_database()) > 400 * 1024 * 1024 then raise exception 'storage_full'; end if;
  if (select count(*) from public.territories where faction_id = new.faction_id) >= 20 then
    raise exception 'quota_territories';
  end if;
  return new;
end $$;
drop trigger if exists guard_quota on public.territories;
create trigger guard_quota before insert on public.territories
  for each row execute function public.guard_territories();

revoke execute on function public.can_draw from public, anon;
grant execute on function public.can_draw to authenticated;

-- Rôle Cartographe : peut tracer les territoires (comme l'Architecte).
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in (
  'createur', 'chef', 'elu', 'conseiller', 'architecte', 'cartographe', 'diplomate', 'milicien', 'mercenaire', 'citoyen',
  'marchand', 'forgeron', 'fermier', 'mineur', 'medecin', 'eclaireur', 'nouveau'));
create or replace function public.can_draw() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_manager() or public.my_role() in ('architecte', 'cartographe')
$$;
