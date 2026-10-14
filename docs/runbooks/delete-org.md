# Borrar una organización

Borrar una organización no se hace desde la app (v1): borra en cascada todos sus datos y no se puede deshacer. Se ejecuta a mano, con la conexión de migraciones (`DATABASE_URL_MIGRATE`, rol `postgres`), nunca con la de la app.

## 1. Respaldo de esa organización

```bash
# Sustituye <ORG_ID>. Guarda el archivo en un lugar privado (contiene datos de un cliente).
pg_dump "$DATABASE_URL_MIGRATE" --data-only --no-owner \
  --table=public.organizations --table=public.memberships --table=public.invitations \
  --table=public.categories --table=public.products --table=public.customers \
  --table=public.orders --table=public.order_items --table=public.stock_movements \
  --table=public.org_counters > org-<ORG_ID>-$(date +%F).sql
```

`pg_dump` vuelca las tablas completas; si prefieres solo esa organización, exporta con `\copy (select ... where org_id = '<ORG_ID>') to ...` por tabla. Comprueba que el archivo no está vacío antes de seguir.

## 2. Borrado

```sql
begin;
-- Evita que los triggers de auditoría escriban filas nuevas mientras se borra.
set local app.deleting_org = '<ORG_ID>';
delete from organizations where id = '<ORG_ID>';   -- cascada a todas las tablas con org_id
commit;
```

Después, `audit_log` conserva el rastro (no tiene FK a propósito). Si el cliente pide borrado total (RGPD o similar), elimina también esas filas:

```sql
delete from audit_log where org_id = '<ORG_ID>';
```

## 3. Usuarios

Borrar la organización no borra las cuentas de `auth.users`. Si alguien ya no pertenece a ninguna organización y quieres eliminar su cuenta, hazlo desde Supabase (Authentication → Users). Su perfil (`profiles`) se borra en cascada.

## Comprobación

```sql
select count(*) from organizations where id = '<ORG_ID>';          -- 0
select count(*) from products where org_id = '<ORG_ID>';           -- 0
```

Para suspender sin borrar, usa `/admin` → Suspender (conserva los datos).
