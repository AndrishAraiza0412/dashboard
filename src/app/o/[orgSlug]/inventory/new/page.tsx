import { Suspense } from "react";
import { ProductFields } from "@/components/inventory/product-fields";
import { ActionForm } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/page-header";
import { createProduct } from "@/server/actions/inventory";
import { listCategories } from "@/server/inventory";
import { loadOrg, requireModule } from "@/server/db/with-org";
import { PageSkeleton } from "@/components/ui/page-skeleton";

export const metadata = { title: "Nuevo producto" };

export default function NewProductPage({ params }: PageProps<"/o/[orgSlug]/inventory/new">) {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/o/[orgSlug]/inventory/new">, "params">) {
  const { orgSlug } = await params;
  const { data: cats } = await loadOrg(orgSlug, "member", async (tx, ctx) => {
    await requireModule(ctx, "inventory");
    return listCategories(tx, ctx.orgId);
  });
  return (
    <div className="fade-in">
      <PageHeader title="Nuevo producto" description="El stock inicial se registra después con un ajuste." />
      <ActionForm action={createProduct.bind(null, orgSlug)} submit="Crear producto" className="max-w-xl">
        <ProductFields categories={cats} />
      </ActionForm>
    </div>
  );
}
