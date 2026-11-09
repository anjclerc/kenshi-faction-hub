-- Kenshi Faction Hub — migration 008 : type de zone tracée (à nous / alliée / neutre / danger).
alter table public.territories add column if not exists kind text not null default 'own'
  check (kind in ('own', 'ally', 'neutral', 'danger'));
