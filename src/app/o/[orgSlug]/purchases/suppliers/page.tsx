// Suppliers: create, edit and activate or deactivate (requires the purchases module).
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { createSupplier, setSupplierActive, updateSupplier } from "@/server/actions/purchases";
import { listSuppliers } from "@/server/purchases";
import { loadOrg, requireModule } from "@/server/db/with-org";

export const metadata = { title: "Proveedores" };

export default function SuppliersPage({ params }: PageProps<"/o/[orgSlug]/purchases/suppliers">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/o/[orgSlug]/purchases/suppliers">, "params">) {
  const { orgSlug } = await params;
  const { ctx, data: rows } = await loadOrg(orgSlug, "viewer", async (tx, ctx) => {
    await requireModule(ctx, "purchases");
    return listSuppliers(tx, ctx.orgId);
  });
  const canEdit = ctx.role !== "viewer";
  return (
    <div className="fade-in">
      <p className="mb-2 text-[13px]"><Link href={`/o/${orgSlug}/purchases`} className="text-muted underline-offset-2 hover:text-ink hover:underline">← Compras</Link></p>
      <PageHeader title="Proveedores" description="Las marcas y distribuidores a los que les compras mercancía." />
      {canEdit && (
        <section aria-labelledby="new-supplier" className="mb-8 max-w-xl rounded-xl border border-hairline bg-surface-card p-6">
          <h2 id="new-supplier" className="mb-3 text-lg font-medium text-ink">Nuevo proveedor</h2>
          <ActionForm action={createSupplier.bind(null, orgSlug)} submit="Añadir proveedor" resetOnSuccess>
            <Field id="new-name" name="name" label="Nombre" required maxLength={120} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="new-email" name="email" label="Correo (opcional)" type="email" autoComplete="off" spellCheck={false} maxLength={160} />
              <Field id="new-phone" name="phone" label="Teléfono (opcional)" type="tel" maxLength={40} />
            </div>
          </ActionForm>
        </section>
      )}
      {rows.length === 0 ? (
        <EmptyState title="Aún no hay proveedores" description="Regístralos para poder enviarles órdenes de compra." />
      ) : (
        <ul className="divide-y divide-hairline-soft rounded-xl border border-hairline bg-canvas">
          {rows.map((s) => (
            <li key={s.id} className="p-4">
              {canEdit ? (
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <ActionForm action={updateSupplier.bind(null, orgSlug, s.id)} submit="Guardar" submitLabel={`Guardar ${s.name}`} variant="secondary" className="grid flex-1 items-end gap-3 space-y-0 sm:grid-cols-[1fr_1fr_1fr_auto] [&>p]:col-span-full">
                    <Field id={`sn-${s.id}`} name="name" label="Nombre" defaultValue={s.name} required maxLength={120} />
                    <Field id={`se-${s.id}`} name="email" label="Correo" type="email" autoComplete="off" spellCheck={false} defaultValue={s.email ?? ""} maxLength={160} />
                    <Field id={`sp-${s.id}`} name="phone" label="Teléfono" type="tel" defaultValue={s.phone ?? ""} maxLength={40} />
                  </ActionForm>
                  <div className="flex items-center gap-2">
                    {!s.active && <Badge>Inactivo</Badge>}
                    <form action={setSupplierActive.bind(null, orgSlug, s.id, !s.active)}>
                      <Button type="submit">{s.active ? "Desactivar" : "Reactivar"}</Button>
                    </form>
                  </div>
                </div>
              ) : (
                <p className="text-ink">{s.name} {s.email && <span className="text-muted">· {s.email}</span>}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
