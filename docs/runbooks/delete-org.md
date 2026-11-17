# Deleting an organization

Deleting an organization is not done from the app (v1): it cascades to all of its data and cannot be undone. It is run by hand, with the migrations connection (`DATABASE_URL_MIGRATE`, `postgres` role), never with the app's connection.

## 1. Back up that organization

```bash
# Replace <ORG_ID>. Store the file somewhere private (it contains a client's data).
pg_dump "$DATABASE_URL_MIGRATE" --data-only --no-owner \
  --table=public.organizations --table=public.memberships --table=public.invitations \
  --table=public.categories --table=public.products --table=public.customers \
  --table=public.orders --table=public.order_items --table=public.stock_movements \
  --table=public.org_counters > org-<ORG_ID>-$(date +%F).sql
```

`pg_dump` dumps whole tables; if you only want that organization, export with `\copy (select ... where org_id = '<ORG_ID>') to ...` per table. Check that the file is not empty before continuing.

## 2. Deletion

```sql
begin;
-- Stops the audit triggers from writing new rows while deleting.
set local app.deleting_org = '<ORG_ID>';
delete from organizations where id = '<ORG_ID>';   -- cascades to every table with org_id
commit;
```

Afterwards, `audit_log` keeps the trail (it has no FK on purpose). If the client asks for total deletion (GDPR or similar), delete those rows too:

```sql
delete from audit_log where org_id = '<ORG_ID>';
```

## 3. Users

Deleting the organization does not delete the `auth.users` accounts. If someone no longer belongs to any organization and you want to remove their account, do it from Supabase (Authentication → Users). Their profile (`profiles`) is deleted in cascade.

## Verification

```sql
select count(*) from organizations where id = '<ORG_ID>';          -- 0
select count(*) from products where org_id = '<ORG_ID>';           -- 0
```

To suspend without deleting, use `/admin` → Suspend (data is kept).
