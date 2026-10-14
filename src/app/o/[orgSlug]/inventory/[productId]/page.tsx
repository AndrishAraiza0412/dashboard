import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductFields } from "@/components/inventory/product-fields";
import { StockBadge } from "@/components/inventory/products-table";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectField } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { dateTime } from "@/lib/format";
import { adjustStock, setProductActive, updateProduct } from "@/server/actions/inventory";
import { getProduct, listCategories, listMovements } from "@/server/inventory";
import { loadOrg, requireModule } from "@/server/db/with-org";
import { PageSkeleton } from "@/components/ui/page-skeleton";

export const metadata = { title: "Producto" };

const REASONS = { restock: "Reposición", adjustment: "Ajuste", sale: "Venta", sale_cancel: "Venta cancelada" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProductPage({ params }: PageProps<"/o/[orgSlug]/inventory/[productId]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={5} />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/o/[orgSlug]/inventory/[productId]">, "params">) {
  const { orgSlug, productId } = await params;
  if (!UUID.test(productId)) notFound();

  const {
    ctx,
    data: [product, cats, movements],
  } = await loadOrg(orgSlug, "viewer", async (tx, ctx) => {
    await requireModule(ctx, "inventory");
    return Promise.all([getProduct(tx, ctx.orgId, productId), listCategories(tx, ctx.orgId), listMovements(tx, ctx.orgId, productId)]);
  });
  if (!product) notFound();
  const canEdit = ctx.role !== "viewer";

  return (
    <div className="fade-in">
      <PageHeader
        title={product.name}
        description={`SKU ${product.sku} · ${product.stockQty} en stock`}
        actions={
          <>
            <StockBadge p={product} />
            {canEdit && (
              <form action={setProductActive.bind(null, orgSlug, product.id, !product.active)}>
                <Button type="submit">{product.active ? "Desactivar" : "Reactivar"}</Button>
              </form>
            )}
          </>
        }
      />

      <div className="grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="details">
          <h2 id="details" className="mb-4 text-lg font-medium text-ink">Detalles</h2>
          {canEdit ? (
            <ActionForm action={updateProduct.bind(null, orgSlug, product.id)} submit="Guardar cambios">
              <ProductFields categories={cats} p={product} />
            </ActionForm>
          ) : (
            <p className="text-muted">Tu rol es de solo lectura.</p>
          )}
        </section>

        <section aria-labelledby="stock">
          <h2 id="stock" className="mb-4 text-lg font-medium text-ink">Stock</h2>
          {canEdit && (
            <ActionForm action={adjustStock.bind(null, orgSlug, product.id)} submit="Registrar movimiento" resetOnSuccess className="mb-8">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="delta" name="delta" label="Cantidad (+ entra, − sale)" type="number" step={1} required />
                <SelectField id="reason" name="reason" label="Motivo" defaultValue="restock">
                  <option value="restock">Reposición</option>
                  <option value="adjustment">Ajuste</option>
                </SelectField>
              </div>
              <Field id="note" name="note" label="Nota (opcional)" maxLength={200} />
            </ActionForm>
          )}
          <h3 className="mb-2 text-[13px] font-medium text-muted">Historial</h3>
          {movements.length === 0 ? (
            <EmptyState title="Sin movimientos" description="Aquí verás cada entrada y salida de stock." />
          ) : (
            <ul className="divide-y divide-hairline-soft rounded-lg border border-hairline">
              {movements.map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <span>
                    <span className="text-ink">{REASONS[m.reason]}</span>
                    {m.note && <span className="text-muted"> · {m.note}</span>}
                    <span className="block text-[13px] text-muted">{dateTime(m.createdAt, ctx.timezone)}</span>
                  </span>
                  <span className="tabular font-medium text-ink">{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
