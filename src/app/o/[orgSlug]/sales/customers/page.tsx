// Customers: create, edit and activate or deactivate (requires the sales module).
import { Suspense } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SelectField } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { createCustomer, setCustomerActive, updateCustomer } from "@/server/actions/sales";
import { CUSTOMER_STATUSES, listCustomers, type CustomerStatus } from "@/server/sales";
import { choice, one } from "@/lib/params";
import Link from "next/link";
import { loadOrg, requireModule } from "@/server/db/with-org";
import { PageSkeleton } from "@/components/ui/page-skeleton";

export const metadata = { title: "Clientes" };

export default function CustomersPage({ params, searchParams }: PageProps<"/o/[orgSlug]/sales/customers">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Pick<PageProps<"/o/[orgSlug]/sales/customers">, "params" | "searchParams">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 80);
  const status = choice(sp.status, Object.keys(CUSTOMER_STATUSES) as CustomerStatus[], "all");
  const { ctx, data: rows } = await loadOrg(orgSlug, "viewer", async (tx, ctx) => {
    await requireModule(ctx, "sales");
    return listCustomers(tx, ctx.orgId, { q, status });
  });
  const canEdit = ctx.role !== "viewer";
  return (
    <div className="fade-in">
      <PageHeader title="Clientes" description="Las personas o empresas a las que vendes." />
      {canEdit && (
        <section aria-labelledby="new-customer" className="mb-8 max-w-xl">
          <h2 id="new-customer" className="mb-3 text-lg font-medium text-ink">Nuevo cliente</h2>
          <ActionForm action={createCustomer.bind(null, orgSlug)} submit="Añadir cliente" resetOnSuccess>
            <Field id="new-name" name="name" label="Nombre" required maxLength={120} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="new-email" name="email" label="Correo (opcional)" type="email" autoComplete="off" spellCheck={false} maxLength={160} />
              <Field id="new-phone" name="phone" label="Teléfono (opcional)" type="tel" maxLength={40} />
            </div>
          </ActionForm>
        </section>
      )}
      <form method="get" role="search" className="mb-4 grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
        <Field id="q" name="q" label="Buscar por nombre, correo o teléfono" type="search" defaultValue={q} />
        <SelectField id="status" name="status" label="Estado" defaultValue={status}>
          {Object.entries(CUSTOMER_STATUSES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </SelectField>
        <Button type="submit">Filtrar</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title={q || status !== "all" ? "Sin resultados" : "Aún no hay clientes"}
          description={q || status !== "all" ? "Prueba con otra búsqueda." : "Puedes crear pedidos sin cliente, pero registrarlos ayuda a dar seguimiento."}
          action={q || status !== "all" ? <Link href={`/o/${orgSlug}/sales/customers`} className="text-sm font-medium text-primary-strong underline">Quitar filtros</Link> : undefined}
        />
      ) : (
        <ul className="divide-y divide-hairline-soft rounded-lg border border-hairline">
          {rows.map((c) => (
            <li key={c.id} className="p-4">
              {canEdit ? (
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <ActionForm action={updateCustomer.bind(null, orgSlug, c.id)} submit="Guardar" submitLabel={`Guardar ${c.name}`} variant="secondary" className="grid flex-1 items-end gap-3 space-y-0 sm:grid-cols-[1fr_1fr_1fr_auto] [&>p]:col-span-full">
                    <Field id={`cn-${c.id}`} name="name" label="Nombre" defaultValue={c.name} required maxLength={120} />
                    <Field id={`ce-${c.id}`} name="email" label="Correo" type="email" autoComplete="off" spellCheck={false} defaultValue={c.email ?? ""} maxLength={160} />
                    <Field id={`cp-${c.id}`} name="phone" label="Teléfono" type="tel" defaultValue={c.phone ?? ""} maxLength={40} />
                  </ActionForm>
                  <div className="flex items-center gap-2">
                    {!c.active && <Badge>Inactivo</Badge>}
                    <form action={setCustomerActive.bind(null, orgSlug, c.id, !c.active)}>
                      <Button type="submit">{c.active ? "Desactivar" : "Reactivar"}</Button>
                    </form>
                  </div>
                </div>
              ) : (
                <p className="text-ink">{c.name} {c.email && <span className="text-muted">· {c.email}</span>}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
