import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectField } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { dateTime, money } from "@/lib/format";
import { addLine, cancelOrder, confirmOrder, fulfillOrder, removeLine, updateLine, updateOrderHeader } from "@/server/actions/sales";
import { getOrder, listActiveProducts, listCustomers, STATUSES, TONES } from "@/server/sales";
import { requireMembership, requireModule, withOrg } from "@/server/db/with-org";

export const metadata = { title: "Pedido" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function OrderPage({ params }: PageProps<"/o/[orgSlug]/sales/[orderId]">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/o/[orgSlug]/sales/[orderId]">, "params">) {
  const { orgSlug, orderId } = await params;
  const ctx = await requireMembership(orgSlug);
  await requireModule(ctx, "sales");
  if (!UUID.test(orderId)) notFound();

  const data = await withOrg(orgSlug, async (tx) => ({
    found: await getOrder(tx, ctx.orgId, orderId),
    customers: await listCustomers(tx, ctx.orgId),
    products: await listActiveProducts(tx, ctx.orgId),
  }));
  if (!data.found) notFound();
  const { order, lines } = data.found;
  const draft = order.status === "draft";
  const canEdit = ctx.role !== "viewer";
  const customerName = data.customers.find((c) => c.id === order.customerId)?.name;

  return (
    <>
      <PageHeader
        title={order.number ? `Pedido #${order.number}` : "Pedido en borrador"}
        description={`${dateTime(order.createdAt, ctx.timezone)}${customerName ? ` · ${customerName}` : ""}`}
        actions={<Badge tone={TONES[order.status]}>{STATUSES[order.status]}</Badge>}
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="lines">
          <h2 id="lines" className="mb-4 text-lg font-medium text-ink">Productos</h2>
          {lines.length === 0 ? (
            <EmptyState title="Sin productos" description={draft ? "Añade productos para poder confirmar el pedido." : undefined} />
          ) : (
            <ul className="divide-y divide-hairline-soft rounded-lg border border-hairline">
              {lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-end justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{l.name}</p>
                    <p className="text-[13px] text-muted">SKU {l.sku}</p>
                  </div>
                  {draft && canEdit ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <ActionForm action={updateLine.bind(null, orgSlug, l.id)} submit="Guardar" submitLabel={`Guardar ${l.name}`} variant="secondary" className="flex flex-wrap items-end gap-2 space-y-0">
                        <Field id={`q-${l.id}`} name="qty" label="Cantidad" type="number" min={1} defaultValue={l.qty} required className="w-24" />
                        <Field id={`p-${l.id}`} name="unitPrice" label="Precio" inputMode="decimal" defaultValue={l.unitPrice} required className="w-28" />
                      </ActionForm>
                      <form action={removeLine.bind(null, orgSlug, l.id)}>
                        <Button type="submit" variant="ghost" aria-label={`Quitar ${l.name}`}>Quitar</Button>
                      </form>
                    </div>
                  ) : (
                    <p className="tabular text-ink">{l.qty} × {money(l.unitPrice, ctx.currency)} = <strong>{money(l.lineTotal ?? 0, ctx.currency)}</strong></p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 flex justify-between text-lg">
            <span className="text-muted">Total</span>
            <span className="tabular font-medium text-ink">{money(order.total, ctx.currency)}</span>
          </p>

          {draft && canEdit && (
            <div className="mt-8">
              <h3 className="mb-3 text-[13px] font-medium text-muted">Añadir producto</h3>
              <ActionForm action={addLine.bind(null, orgSlug, order.id)} submit="Añadir" variant="secondary" resetOnSuccess className="flex flex-wrap items-end gap-3 space-y-0">
                <SelectField id="productId" name="productId" label="Producto" defaultValue="" required className="min-w-56">
                  <option value="" disabled>Elige…</option>
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.stockQty} en stock)</option>
                  ))}
                </SelectField>
                <Field id="qty" name="qty" label="Cantidad" type="number" min={1} defaultValue={1} required className="w-24" />
              </ActionForm>
            </div>
          )}
        </section>

        <aside className="space-y-8">
          {draft && canEdit ? (
            <section aria-labelledby="header">
              <h2 id="header" className="mb-4 text-lg font-medium text-ink">Datos</h2>
              <ActionForm action={updateOrderHeader.bind(null, orgSlug, order.id)} submit="Guardar" variant="secondary">
                <SelectField id="customerId" name="customerId" label="Cliente" defaultValue={order.customerId ?? ""}>
                  <option value="">Sin cliente</option>
                  {data.customers.filter((c) => c.active || c.id === order.customerId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </SelectField>
                <Field id="notes" name="notes" label="Notas (opcional)" defaultValue={order.notes ?? ""} maxLength={500} />
              </ActionForm>
            </section>
          ) : (
            order.notes && <p className="text-muted">{order.notes}</p>
          )}

          {canEdit && order.status !== "fulfilled" && order.status !== "cancelled" && (
            <section aria-labelledby="actions" className="space-y-3">
              <h2 id="actions" className="text-lg font-medium text-ink">Acciones</h2>
              {draft && <ActionForm action={confirmOrder.bind(null, orgSlug, order.id)} submit="Confirmar pedido" />}
              {order.status === "confirmed" && <ActionForm action={fulfillOrder.bind(null, orgSlug, order.id)} submit="Marcar como completado" />}
              <ConfirmActionButton
                action={cancelOrder.bind(null, orgSlug, order.id)}
                trigger="Cancelar pedido"
                destructive
                title="¿Cancelar este pedido?"
                description={draft ? "El borrador se marcará como cancelado." : "El stock de los productos se repondrá."}
                confirmLabel="Cancelar pedido"
              />
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
