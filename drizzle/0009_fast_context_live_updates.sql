-- 1) The request context in ONE statement.
-- Every page used to run set_config(...) and then a membership query: two statements, and through the transaction
-- pooler each parameterized statement costs two round trips. app_context() sets the verified claims itself and
-- returns the membership and the user's organizations, so the caller needs a single statement.
-- Same trust as before: only app_rls (the server, which verifies the JWT) can call it; it lives in `private`,
-- which the Data API does not expose, and is not granted to authenticated.
create or replace function private.app_context(p_claims text, p_slug text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', p_claims, true);
  return jsonb_build_object(
    'org', (
      select to_jsonb(x) from (
        select o.id as "orgId", o.slug, o.name, o.currency, o.timezone, o.enabled_modules as modules,
               m.role, m.user_id as "userId"
        from public.memberships m
        join public.organizations o on o.id = m.org_id
        where o.slug = p_slug
          and m.user_id = (select auth.uid())
          and o.suspended_at is null -- same rule as private.user_org_ids(): a suspended org is not visible
      ) x
    ),
    'orgs', coalesce((
      select jsonb_agg(jsonb_build_object('slug', o.slug, 'name', o.name, 'role', m.role) order by o.name)
      from public.memberships m
      join public.organizations o on o.id = m.org_id
      where m.user_id = (select auth.uid()) and o.suspended_at is null
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function private.app_context(text, text) from public, anon, authenticated;
grant execute on function private.app_context(text, text) to app_rls;

-- 2) Live updates: every audited write pings the organization's private Realtime channel ("org:<id>").
-- The payload carries only the entity names (no row data); the browser then re-fetches through the normal,
-- RLS-checked server path. Who may listen is decided by the policy on realtime.messages below.
create or replace function private.broadcast_org_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select org_id, jsonb_agg(distinct entity) as entities from new_rows where org_id is not null group by org_id
  loop
    begin
      perform realtime.send(jsonb_build_object('entities', r.entities), 'change', 'org:' || r.org_id, true);
    exception when others then
      raise warning 'broadcast_org_change: %', sqlerrm; -- a lost ping must never roll back the user's write
    end;
  end loop;
  return null;
end
$$;
revoke all on function private.broadcast_org_change() from public, anon, authenticated;

drop trigger if exists broadcast_org_change on public.audit_log;
create trigger broadcast_org_change after insert on public.audit_log
  referencing new table as new_rows
  for each statement execute function private.broadcast_org_change();

-- Members (any role) of a non-suspended org may receive its pings; nobody may send from the client.
drop policy if exists org_change_receive on realtime.messages;
create policy org_change_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) in (select 'org:' || id from private.user_org_ids() as id)
  );
