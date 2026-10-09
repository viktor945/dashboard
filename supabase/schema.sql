-- Run in Supabase SQL Editor once, before connecting the website.
-- Each authenticated user owns exactly one dashboard; RLS isolates rows.
begin;
create table if not exists public.dashboards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint dashboard_shape check (
    jsonb_typeof(payload) = 'object' and payload ?& array['version','tasks','categories'] and payload->>'version' = '1'
    and jsonb_typeof(payload->'tasks') = 'array'
    and jsonb_typeof(payload->'categories') = 'array'
    and octet_length(payload::text) <= 20000000
  )
);
alter table public.dashboards enable row level security;
alter table public.dashboards force row level security;
revoke all on public.dashboards from anon;
revoke all on public.dashboards from authenticated;
grant select, insert, update on public.dashboards to authenticated;
drop policy if exists dashboard_read_own on public.dashboards;
create policy dashboard_read_own on public.dashboards for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists dashboard_insert_own on public.dashboards;
create policy dashboard_insert_own on public.dashboards for insert to authenticated with check ((select auth.uid()) = user_id and revision = 1);
drop policy if exists dashboard_update_own on public.dashboards;
create policy dashboard_update_own on public.dashboards for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Optimistic concurrency: one edit wins; a stale device cannot overwrite it.
create or replace function public.bump_dashboard_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists bump_revision on public.dashboards;
create trigger bump_revision before update on public.dashboards for each row execute function public.bump_dashboard_revision();
commit;
