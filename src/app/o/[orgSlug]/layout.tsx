import { Suspense } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { listMyOrgs, requireMembership } from "@/server/db/with-org";
import { getClaims } from "@/server/auth";

export default function OrgLayout({ children, params }: LayoutProps<"/o/[orgSlug]">) {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-busy="true" />}>
      <Shell params={params}>{children}</Shell>
    </Suspense>
  );
}

// The layout only renders chrome. Authorization is repeated by every page and Server Action,
// because layouts are not re-run on client navigation and do not guard Server Actions.
async function Shell({ params, children }: { params: Promise<{ orgSlug: string }>; children: React.ReactNode }) {
  const { orgSlug } = await params;
  const ctx = await requireMembership(orgSlug);
  const [orgs, claims] = await Promise.all([listMyOrgs(), getClaims()]);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:rounded-md focus:bg-canvas focus:px-4 focus:py-2 focus:text-ink">
        Saltar al contenido
      </a>
      <Sidebar ctx={ctx} orgs={orgs} />
      <div className="min-w-0 flex-1">
        <div className="flex justify-end border-b border-hairline px-4 py-2 sm:px-6">
          <UserMenu email={claims?.email} />
        </div>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
