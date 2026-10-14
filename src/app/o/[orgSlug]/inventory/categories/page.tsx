import { Suspense } from "react";
import { DeleteCategoryButton } from "@/components/inventory/delete-category-button";
import { ActionForm } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { createCategory, deleteCategory, renameCategory } from "@/server/actions/inventory";
import { listCategories } from "@/server/inventory";
import { requireMembership, requireModule, withOrg } from "@/server/db/with-org";

export const metadata = { title: "Categorías" };

export default function CategoriesPage({ params }: PageProps<"/o/[orgSlug]/inventory/categories">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/o/[orgSlug]/inventory/categories">, "params">) {
  const { orgSlug } = await params;
  const ctx = await requireMembership(orgSlug);
  await requireModule(ctx, "inventory");
  const cats = await withOrg(orgSlug, (tx) => listCategories(tx, ctx.orgId));
  const canEdit = ctx.role !== "viewer";
  return (
    <>
      <PageHeader title="Categorías" description="Agrupa tus productos." />
      {canEdit && (
        <ActionForm action={createCategory.bind(null, orgSlug)} submit="Añadir categoría" resetOnSuccess className="mb-8 max-w-sm">
          <Field id="new-category" name="name" label="Nueva categoría" required maxLength={60} />
        </ActionForm>
      )}
      {cats.length === 0 ? (
        <EmptyState title="Aún no hay categorías" description="Son opcionales: puedes tener productos sin categoría." />
      ) : (
        <ul className="divide-y divide-hairline-soft rounded-lg border border-hairline">
          {cats.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-4 p-4">
              {canEdit ? (
                <>
                  <ActionForm action={renameCategory.bind(null, orgSlug, c.id)} submit="Guardar" submitLabel={`Guardar categoría ${c.name}`} variant="secondary" className="flex flex-wrap items-end gap-2 space-y-0">
                    <Field id={`cat-${c.id}`} name="name" label="Nombre" defaultValue={c.name} required maxLength={60} />
                  </ActionForm>
                  <DeleteCategoryButton name={c.name} action={deleteCategory.bind(null, orgSlug, c.id)} />
                </>
              ) : (
                <span className="text-ink">{c.name}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
