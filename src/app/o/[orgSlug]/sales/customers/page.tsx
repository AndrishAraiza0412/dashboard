import { Suspense } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { createCustomer, setCustomerActive, updateCustomer } from "@/server/actions/sales";
import { listCustomers } from "@/server/sales";
import { requireMembership, requireModule, withOrg } from "@/server/db/with-org";

export const metadata = { title: "Clientes" };

export default function CustomersPage({ params }: PageProps<"/o/[orgSlug]/sales/customers">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/o/[orgSlug]/sales/customers">, "params">) {
  const { orgSlug } = await params;
  const ctx = await requireMembership(orgSlug);
  await requireModule(ctx, "sales");
  const rows = await withOrg(orgSlug, (tx) => listCustomers(tx, ctx.orgId));
  const canEdit = ctx.role !== "viewer";
  return (
    <>
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
      {rows.length === 0 ? (
        <EmptyState title="Aún no hay clientes" description="Puedes crear pedidos sin cliente, pero registrarlos ayuda a dar seguimiento." />
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
    </>
  );
}
