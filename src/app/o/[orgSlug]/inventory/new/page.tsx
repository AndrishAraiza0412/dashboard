import { Suspense } from "react";
import { ProductFields } from "@/components/inventory/product-fields";
import { ActionForm } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/page-header";
import { createProduct } from "@/server/actions/inventory";
import { listCategories } from "@/server/inventory";
import { requireMembership, requireModule, withOrg } from "@/server/db/with-org";

export const metadata = { title: "Nuevo producto" };

export default function NewProductPage({ params }: PageProps<"/o/[orgSlug]/inventory/new">) {
  return (
    <Suspense fallback={null}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/o/[orgSlug]/inventory/new">, "params">) {
  const { orgSlug } = await params;
  const ctx = await requireMembership(orgSlug, "member");
  await requireModule(ctx, "inventory");
  const cats = await withOrg(orgSlug, (tx) => listCategories(tx, ctx.orgId));
  return (
    <>
      <PageHeader title="Nuevo producto" description="El stock inicial se registra después con un ajuste." />
      <ActionForm action={createProduct.bind(null, orgSlug)} submit="Crear producto" className="max-w-xl">
        <ProductFields categories={cats} />
      </ActionForm>
    </>
  );
}
