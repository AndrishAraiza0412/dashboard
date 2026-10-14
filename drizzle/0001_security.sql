-- Security layer: runtime role, RLS helpers, grants and policies.
-- Isolation fails closed: without verified claims auth.uid() is null and every policy returns 0 rows.

-- Runtime login role. Password is set outside the repo:
--   alter role app_rls password '<secret>';
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rls') then
    create role app_rls login nobypassrls;
  end if;
end
$$;
grant authenticated to app_rls;

-- No implicit grants on anything created later by migrations (run as postgres).
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;
revoke all on all tables in schema public from anon, authenticated;

-- RLS helpers in a schema that is never exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.user_org_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.org_id
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = (select auth.uid())
    and o.suspended_at is null
$$;

create or replace function private.has_role(org uuid, roles public.member_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.org_id = org
      and m.user_id = (select auth.uid())
      and m.role = any(roles)
      and o.suspended_at is null
  )
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.user_org_ids() to authenticated;
grant execute on function private.has_role(uuid, public.member_role[]) to authenticated;

-- organizations
alter table public.organizations enable row level security;
grant select on public.organizations to authenticated;
grant update (name, currency, timezone) on public.organizations to authenticated;
create policy organizations_select on public.organizations for select to authenticated
  using (id in (select private.user_org_ids()));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_role(id, '{admin}'))
  with check (private.has_role(id, '{admin}'));

-- memberships: read-only for users; writes go through SECURITY DEFINER functions.
alter table public.memberships enable row level security;
grant select on public.memberships to authenticated;
create policy memberships_select on public.memberships for select to authenticated
  using (org_id in (select private.user_org_ids()));

-- categories
alter table public.categories enable row level security;
grant select, delete on public.categories to authenticated;
grant insert (org_id, name) on public.categories to authenticated;
grant update (name) on public.categories to authenticated;
create policy categories_select on public.categories for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy categories_insert on public.categories for insert to authenticated
  with check (private.has_role(org_id, '{admin,member}'));
create policy categories_update on public.categories for update to authenticated
  using (private.has_role(org_id, '{admin,member}'))
  with check (private.has_role(org_id, '{admin,member}'));
create policy categories_delete on public.categories for delete to authenticated
  using (private.has_role(org_id, '{admin,member}'));
