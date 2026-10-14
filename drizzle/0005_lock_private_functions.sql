-- Functions default to EXECUTE for PUBLIC. 0001 revoked that only for functions that existed then.
-- Lock every function in `private` (trigger functions are never called by users), then re-grant
-- the three RLS helpers, and make the same the default for anything added later.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.user_org_ids() to authenticated;
grant execute on function private.has_role(uuid, public.member_role[]) to authenticated;
grant execute on function private.is_platform_admin() to authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;
