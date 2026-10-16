# Dar de alta un cliente

Un cliente es una **organización**. Sus datos quedan aislados de los demás clientes en la base de datos (RLS). Esto no se puede saltar ni con un error en el código de la app.

## Sin tocar código (desde la app)

| Qué | Dónde |
|---|---|
| Crear la organización e invitar a su primer administrador | `/admin` → *Nueva organización* (nombre, slug de la URL, moneda, zona horaria, correo del admin) |
| Activar o quitar módulos: Inventario, Ventas, Compras | `/admin` → casillas de la organización → *Guardar módulos*. Ventas y Compras necesitan Inventario |
| Cambiar nombre, moneda o zona horaria | El admin del cliente, en *Ajustes* |
| Invitar usuarios y asignar rol (admin, miembro, solo lectura) | El admin del cliente, en *Ajustes* |
| Suspender o reactivar | `/admin` → *Suspender*. Los datos se conservan y sus usuarios dejan de verla |
| Apariencia (claro/oscuro, cristal, paleta) | Cada usuario, en el botón de paleta de la barra superior (se guarda en su navegador) |

`/admin` solo lo ven los administradores de plataforma. El primero se da de alta por SQL (`deploy.md` §1.9).

## Con variables de entorno (Vercel, sin cambiar código)

- `NEXT_PUBLIC_APP_NAME`: nombre del producto en títulos, en la pantalla de acceso y como remitente de correo.
- `EMAIL_FROM`: remitente completo, por ejemplo `Mi Marca <avisos@mi-dominio.com>`.
- Lista completa de variables: `.env.example`.

## Cambios que sí requieren código

| Petición típica | Qué tocar |
|---|---|
| Un módulo nuevo (por ejemplo, Nómina) | Una línea en `src/lib/modules.ts`, sus páginas con `requireModule(ctx, "<id>")`, una entrada en `NAV` (`src/components/shell/sidebar.tsx`) y una migración que añada el id al check `organizations_modules_known` (`src/db/schema.ts` → `npx drizzle-kit generate`) |
| Un campo nuevo en productos, clientes, etc. | Columna en `src/db/schema.ts` → `npx drizzle-kit generate` → `grant insert/update (<columna>)` a `authenticated` en una migración `--custom`. Drizzle nombra todas las columnas en el INSERT, así que el grant es obligatorio. Después: el formulario y la acción con su validación Zod |
| Un indicador o gráfica nueva en el Resumen | `src/server/metrics.ts` (es UNA sentencia SQL: añade un sub-select, no otra consulta) y `src/app/o/[orgSlug]/page.tsx` |
| Una tabla nueva | Seguir el patrón de `drizzle/0007_purchases.sql` + `0008_purchases_security.sql`: RLS por `org_id`, auditoría, triggers que fuerzan los campos sensibles y funciones `security definer` para los cambios de estado. Con el trigger de auditoría la tabla ya actualiza las pantallas en vivo |

Cada cambio de base de datos es una migración en `drizzle/` y se aplica sola en el deploy (`deploy.yml`). Las migraciones son *expand/contract*: nunca borrar ni renombrar una columna en el mismo deploy que el código que deja de usarla.

## Cómo se mantiene todo al día (para no romperlo)

- Las acciones son Server Actions con `revalidatePath`: la vista se actualiza en el mismo lugar, sin recargar.
- Cualquier escritura auditada (de cualquier usuario o pestaña) envía un aviso sin datos al canal privado de Realtime `org:<id>`. `LiveUpdates` (`src/components/shell/live-updates.tsx`) responde con `router.refresh()`. Lo hace el trigger `broadcast_org_change` sobre `audit_log` (migración `0009`). Una tabla nueva solo necesita su trigger de auditoría.
- Rendimiento: cada página abre UNA transacción. Su primera sentencia (`private.app_context`) fija la identidad y comprueba la membresía. Regla: **pocas sentencias por petición y grandes**. Por el pooler, cada sentencia con parámetros cuesta dos idas y vueltas.

## Antes del primer cliente de pago

Ver `deploy.md` (*Planes*): Supabase Pro (copias diarias y PITR), Vercel Pro (uso comercial), Sentry, CSP con nonce, dominio y SMTP propio (Resend). **La región de Vercel (`vercel.json` → `regions`) debe ser la misma que la de Supabase.** Hoy es `iad1` = `us-east-1`. Si no coinciden, cada consulta paga ~70 ms extra.
