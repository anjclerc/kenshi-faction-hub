-- Kenshi Faction Hub — migration 009 : visibilité des territoires (privé / alliés / tous).
alter table public.territories add column if not exists visibility text not null default 'public'
  check (visibility in ('faction', 'allies', 'public'));
drop policy if exists territories_read on public.territories;
create policy territories_read on public.territories for select to anon, authenticated
  using (visibility = 'public'
         or faction_id = public.my_faction()
         or (visibility = 'allies' and auth.uid() is not null
             and public.ally_share('f:' || faction_id::text) is not null));
