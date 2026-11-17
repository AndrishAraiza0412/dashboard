// Inventory list: products and their stock, driven by search parameters (requires the inventory module).
import Link from "next/link";
import { Suspense } from "react";
import { ProductsTable } from "@/components/inventory/products-table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectField } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Pagination } from "@/components/ui/pagination";
import { choice, isUuid, one, pageParam, PAGE_SIZES, query, sizeParam } from "@/lib/params";
import { listCategories, listProducts, PRODUCT_SORTS, PRODUCT_STATUSES, type ProductSort, type ProductStatus } from "@/server/inventory";
import { loadOrg, requireModule } from "@/server/db/with-org";

export const metadata = { title: "Inventario" };

export default function InventoryPage({ params, searchParams }: PageProps<"/o/[orgSlug]/inventory">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Pick<PageProps<"/o/[orgSlug]/inventory">, "params" | "searchParams">) {
  const { orgSlug } = await params;
  const sp = await searchParams;

  const q = one(sp.q)?.slice(0, 80);
  const category = one(sp.category);
  const categoryId = isUuid(category) ? category : undefined;
  const stock = choice(sp.stock, ["", "low", "out"] as const, "");
  const status = choice(sp.status, Object.keys(PRODUCT_STATUSES) as ProductStatus[], "all");
  const sort = choice(sp.sort, Object.keys(PRODUCT_SORTS) as ProductSort[], "name_asc");
  const size = sizeParam(sp.size);
  const page = pageParam(sp.page);

  const {
    ctx,
    data: [{ rows, total }, cats],
  } = await loadOrg(orgSlug, "viewer", async (tx, ctx) => {
    await requireModule(ctx, "inventory");
    return Promise.all([
      listProducts(tx, ctx.orgId, { q, categoryId, stock: stock || undefined, status, sort, page, size }),
      listCategories(tx, ctx.orgId),
    ]);
  });

  const base = `/o/${orgSlug}/inventory`;
  const pages = Math.max(1, Math.ceil(total / size));
  const href = (p: number) => `${base}${query({ q, category: categoryId, stock, status, sort, size, page: p > 1 ? p : undefined }, { status: "all", sort: "name_asc", size: 20 })}`;
  const canEdit = ctx.role !== "viewer";
  const filtered = Boolean(q || categoryId || stock || status !== "all");

  return (
    <div className="fade-in">
      <PageHeader
        title="Inventario"
        description={`${total} ${total === 1 ? "producto" : "productos"}`}
        actions={
          <>
            <Link href={`${base}/categories`} className="inline-flex h-10 items-center rounded-md border border-hairline px-5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-soft">
              Categorías
            </Link>
            {canEdit && (
              <Link href={`${base}/new`} className="inline-flex h-10 items-center rounded-md bg-primary-strong px-5 text-sm font-medium text-on-primary transition-colors duration-150 hover:bg-primary-hover">
                Nuevo producto
              </Link>
            )}
          </>
        }
      />

      <form method="get" action={base} role="search" className="mb-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="q" name="q" label="Buscar por nombre o SKU" type="search" defaultValue={q} />
          <Button type="submit">Filtrar</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SelectField id="category" name="category" label="Categoría" defaultValue={categoryId ?? ""}>
            <option value="">Todas</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
          <SelectField id="stock" name="stock" label="Stock" defaultValue={stock}>
            <option value="">Todo</option>
            <option value="low">Stock bajo</option>
            <option value="out">Agotado</option>
          </SelectField>
          <SelectField id="status" name="status" label="Estado" defaultValue={status}>
            {Object.entries(PRODUCT_STATUSES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
          <SelectField id="sort" name="sort" label="Ordenar por" defaultValue={sort}>
            {Object.entries(PRODUCT_SORTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </SelectField>
          <SelectField id="size" name="size" label="Por página" defaultValue={String(size)}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </SelectField>
        </div>
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

      <Pagination page={page} pages={pages} total={total} href={href} />
    </div>
  );
}
