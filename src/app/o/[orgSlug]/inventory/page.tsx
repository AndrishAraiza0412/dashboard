import Link from "next/link";
import { Suspense } from "react";
import { ProductsTable } from "@/components/inventory/products-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { listCategories, listProducts, PAGE_SIZE, type StockFilter } from "@/server/inventory";
import { requireMembership, requireModule, withOrg } from "@/server/db/with-org";

export const metadata = { title: "Inventario" };

export default function InventoryPage({ params, searchParams }: PageProps<"/o/[orgSlug]/inventory">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

async function Content({ params, searchParams }: Pick<PageProps<"/o/[orgSlug]/inventory">, "params" | "searchParams">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireMembership(orgSlug);
  await requireModule(ctx, "inventory");

  const q = one(sp.q)?.slice(0, 80);
  const categoryId = one(sp.category);
  const stock = (["low", "out"] as const).find((s) => s === one(sp.stock)) as StockFilter | undefined;
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);

  const [{ rows, total }, cats] = await withOrg(orgSlug, async (tx) => [
    await listProducts(tx, ctx.orgId, { q, categoryId: categoryId && /^[0-9a-f-]{36}$/i.test(categoryId) ? categoryId : undefined, stock, page }),
    await listCategories(tx, ctx.orgId),
  ] as const);

  const base = `/o/${orgSlug}/inventory`;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (categoryId) u.set("category", categoryId);
    if (stock) u.set("stock", stock);
    if (p > 1) u.set("page", String(p));
    return `${base}${u.size ? `?${u}` : ""}`;
  };
  const canEdit = ctx.role !== "viewer";
  const filtered = Boolean(q || categoryId || stock);

  return (
    <>
      <PageHeader
        title="Inventario"
        description={`${total} ${total === 1 ? "producto" : "productos"}`}
        actions={
          <>
            <Link href={`${base}/categories`} className="inline-flex h-10 items-center rounded-md border border-hairline px-5 text-sm font-medium text-ink hover:bg-surface-soft">
              Categorías
            </Link>
            {canEdit && (
              <Link href={`${base}/new`} className="inline-flex h-10 items-center rounded-md bg-primary-strong px-5 text-sm font-medium text-on-primary hover:bg-primary-hover">
                Nuevo producto
              </Link>
            )}
          </>
        }
      />

      <form method="get" action={base} role="search" className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_160px_auto] sm:items-end">
        <Field id="q" name="q" label="Buscar por nombre o SKU" type="search" defaultValue={q} />
        <SelectField id="category" name="category" label="Categoría" defaultValue={categoryId ?? ""}>
          <option value="">Todas</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField id="stock" name="stock" label="Stock" defaultValue={stock ?? ""}>
          <option value="">Todo</option>
          <option value="low">Stock bajo</option>
          <option value="out">Agotado</option>
        </SelectField>
        <Button type="submit">Filtrar</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "Sin resultados" : "Aún no hay productos"}
          description={filtered ? "Prueba con otros filtros." : canEdit ? "Crea tu primer producto para empezar a llevar el stock." : "Un miembro del equipo puede crear los primeros productos."}
          action={filtered ? <Link href={base} className="text-sm font-medium text-primary-strong underline">Quitar filtros</Link> : undefined}
        />
      ) : (
        <ProductsTable rows={rows} base={base} currency={ctx.currency} />
      )}

      {pages > 1 && (
        <nav aria-label="Paginación" className="mt-4 flex items-center justify-between text-[13px] text-muted">
          <span>
            Página {page} de {pages}
          </span>
          <span className="flex gap-2">
            {page > 1 && <Link href={href(page - 1)} className="rounded-md border border-hairline px-4 py-2 text-ink hover:bg-surface-soft">Anterior</Link>}
            {page < pages && <Link href={href(page + 1)} className="rounded-md border border-hairline px-4 py-2 text-ink hover:bg-surface-soft">Siguiente</Link>}
          </span>
        </nav>
      )}
    </>
  );
}
