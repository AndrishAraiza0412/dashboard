import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { UserMenu } from "@/components/shell/user-menu";
import { getClaims } from "@/server/auth";
import { listMyOrgs } from "@/server/db/with-org";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Landing />
    </Suspense>
  );
}

async function Landing() {
  const claims = await getClaims();
  if (!claims) redirect("/login");
  const orgs = await listMyOrgs();
  if (orgs.length > 0) redirect(`/o/${orgs[0].slug}`);
  return (
    <main className="mx-auto max-w-md px-4 py-24">
      <div className="mb-6 flex justify-end">
        <UserMenu email={claims.email} />
      </div>
      <EmptyState title="Aún no perteneces a ninguna organización" description="Pide una invitación a tu administrador y abre el enlace que te enviará por correo." />
    </main>
  );
}
