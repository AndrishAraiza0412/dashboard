-- Drizzle names every column in INSERT (using DEFAULT for the ones it isn't given),
-- and Postgres requires INSERT privilege on every named column. Grant the
-- harmless columns (id, created_at) so Drizzle inserts work; keep sensitive
-- columns (created_by, actor_id, ...) ungranted and set them via triggers.
-- Rule for later tables: never grant INSERT on a column whose value must not be forgeable;
-- fill it in a BEFORE INSERT trigger that overwrites it with auth.uid().
grant insert (id, created_at) on public.categories to authenticated;
