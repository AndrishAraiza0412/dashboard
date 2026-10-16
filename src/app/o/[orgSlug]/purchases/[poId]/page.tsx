import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectField } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { dateTime, money } from "@/lib/format";
import { addPurchaseLine, cancelPurchaseOrder, placePurchaseOrder, receivePurchaseOrder, removePurchaseLine, updatePurchaseHeader, updatePurchaseLine } from "@/server/actions/purchases";
import { getPurchaseOrder, listPurchasableProducts, listSuppliers, poNumber, PURCHASE_STATUSES, PURCHASE_TONES } from "@/server/purchases";
import { loadOrg, requireModule } from "@/server/db/with-org";

export const metadata = { title: "Orden de compra" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PurchaseOrderPage({ params }: PageProps<"/o/[orgSlug]/purchases/[poId]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/o/[orgSlug]/purchases/[poId]">, "params">) {
  const { orgSlug, poId } = await params;
  if (!UUID.test(poId)) notFound();

  const { ctx, data } = await loadOrg(orgSlug, "viewer", async (tx, ctx) => {
    await requireModule(ctx, "purchases");
    const [found, suppliers, products] = await Promise.all([getPurchaseOrder(tx, ctx.orgId, poId), listSuppliers(tx, ctx.orgId), listPurchasableProducts(tx, ctx.orgId)]);
    return { found, suppliers, products };
  });
  if (!data.found) notFound();
  const { po, lines } = data.found;
  const draft = po.status === "draft";
  const canEdit = ctx.role !== "viewer";
  const supplier = data.suppliers.find((s) => s.id === po.supplierId);
  const units = lines.reduce((n, l) => n + l.qty, 0);
  const when = po.receivedAt ? `Recibida ${dateTime(po.receivedAt, ctx.timezone)}` : po.orderedAt ? `Enviada ${dateTime(po.orderedAt, ctx.timezone)}` : `Creada ${dateTime(po.createdAt, ctx.timezone)}`;

  return (
    <div className="fade-in">
      <p className="mb-2 text-[13px]"><Link href={`/o/${orgSlug}/purchases`} className="text-muted underline-offset-2 hover:text-ink hover:underline">← Compras</Link></p>
      <PageHeader
        title={po.number ? `Orden ${poNumber(po.number)}` : "Orden de compra en borrador"}
        description={`${when}${supplier ? ` · ${supplier.name}` : ""}`}
        actions={<Badge tone={PURCHASE_TONES[po.status]}>{PURCHASE_STATUSES[po.status]}</Badge>}
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="lines">
          <h2 id="lines" className="mb-4 text-lg font-medium text-ink">Productos</h2>
          {lines.length === 0 ? (
            <EmptyState title="Sin productos" description={draft ? "Añade los productos que vas a pedir al proveedor." : undefined} />
          ) : (
            <ul className="divide-y divide-hairline-soft rounded-xl border border-hairline bg-canvas">
              {lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-end justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{l.name}</p>
                    <p className="text-[13px] text-muted">SKU {l.sku} · {l.stockQty} en stock</p>
                  </div>
                  {draft && canEdit ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <ActionForm action={updatePurchaseLine.bind(null, orgSlug, l.id)} submit="Guardar" submitLabel={`Guardar ${l.name}`} variant="secondary" className="flex flex-wrap items-end gap-2 space-y-0">
                        <Field id={`q-${l.id}`} name="qty" label="Cantidad" type="number" min={1} defaultValue={l.qty} required className="w-24" />
                        <Field id={`c-${l.id}`} name="unitCost" label="Costo" inputMode="decimal" defaultValue={l.unitCost} required className="w-28" />
                      </ActionForm>
                      <form action={removePurchaseLine.bind(null, orgSlug, l.id)}>
                        <Button type="submit" variant="ghost" aria-label={`Quitar ${l.name}`}>Quitar</Button>
                      </form>
                    </div>
                  ) : (
                    <p className="tabular text-ink">{l.qty} × {money(l.unitCost, ctx.currency)} = <strong>{money(l.lineTotal ?? 0, ctx.currency)}</strong></p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 flex justify-between text-lg">
            <span className="text-muted">Total ({units} {units === 1 ? "pieza" : "piezas"})</span>
            <span className="tabular font-medium text-ink">{money(po.total, ctx.currency)}</span>
          </p>

          {draft && canEdit && (
            <div className="mt-8">
              <h3 className="mb-3 text-[13px] font-medium text-muted">Añadir producto</h3>
              <ActionForm action={addPurchaseLine.bind(null, orgSlug, po.id)} submit="Añadir" variant="secondary" resetOnSuccess className="flex flex-wrap items-end gap-3 space-y-0">
                <SelectField id="productId" name="productId" label="Producto" defaultValue="" required className="min-w-56">
                  <option value="" disabled>Elige…</option>
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.stockQty} en stock{p.stockQty <= p.reorderLevel ? ", bajo" : ""})</option>
                  ))}
                </SelectField>
                <Field id="qty" name="qty" label="Cantidad" type="number" min={1} defaultValue={10} required className="w-24" />
              </ActionForm>
            </div>
          )}
        </section>

        <aside className="space-y-8">
          {draft && canEdit ? (
            <section aria-labelledby="header">
              <h2 id="header" className="mb-4 text-lg font-medium text-ink">Datos</h2>
              <ActionForm action={updatePurchaseHeader.bind(null, orgSlug, po.id)} submit="Guardar" variant="secondary">
                <SelectField id="supplierId" name="supplierId" label="Proveedor" defaultValue={po.supplierId ?? ""}>
                  <option value="">Sin proveedor</option>
                  {data.suppliers.filter((s) => s.active || s.id === po.supplierId).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </SelectField>
                <Field id="notes" name="notes" label="Notas (opcional)" defaultValue={po.notes ?? ""} maxLength={500} />
              </ActionForm>
              {data.suppliers.length === 0 && (
                <p className="mt-3 text-[13px] text-muted">
                  Aún no tienes proveedores. <Link href={`/o/${orgSlug}/purchases/suppliers`} className="text-primary-text underline">Crea uno</Link>.
                </p>
              )}
            </section>
          ) : (
            <section className="space-y-1">
              {supplier && (
                <p className="text-ink">
                  {supplier.name}
                  {supplier.email && <span className="block text-[13px] text-muted">{supplier.email}</span>}
                  {supplier.phone && <span className="block text-[13px] text-muted">{supplier.phone}</span>}
                </p>
              )}
              {po.notes && <p className="text-muted">{po.notes}</p>}
            </section>
          )}

          {canEdit && (draft || po.status === "ordered") && (
            <section aria-labelledby="actions" className="space-y-3">
              <h2 id="actions" className="text-lg font-medium text-ink">Acciones</h2>
              {draft && <ActionForm action={placePurchaseOrder.bind(null, orgSlug, po.id)} submit="Enviar al proveedor" />}
              {po.status === "ordered" && (
                <>
                  <p className="text-[13px] text-muted">Cuando llegue la mercancía, márcala como recibida: el stock de cada producto subirá.</p>
                  <ActionForm action={receivePurchaseOrder.bind(null, orgSlug, po.id)} submit="Marcar como recibida" />
                </>
              )}
              <ConfirmActionButton
                action={cancelPurchaseOrder.bind(null, orgSlug, po.id)}
                trigger="Cancelar orden"
                destructive
                title="¿Cancelar esta orden de compra?"
                description="No se recibió mercancía, así que el stock no cambia."
                confirmLabel="Cancelar orden"
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
