import { Suspense } from "react";
import { LiveUpdates } from "@/components/shell/live-updates";
import { Sidebar } from "@/components/shell/sidebar";
import { ThemePicker } from "@/components/shell/theme-picker";
import { UserMenu } from "@/components/shell/user-menu";
import { getShell } from "@/server/db/with-org";
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
  const [{ ctx, orgs }, claims] = await Promise.all([getShell(orgSlug), getClaims()]);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:rounded-md focus:bg-canvas focus:px-4 focus:py-2 focus:text-ink">
        Saltar al contenido
      </a>
      <LiveUpdates orgId={ctx.orgId} />
      <Sidebar ctx={ctx} orgs={orgs} />
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex items-center justify-end gap-1 border-b border-hairline bg-canvas/80 px-4 py-2 backdrop-blur-md sm:px-6">
          <ThemePicker />
          <UserMenu email={claims?.email} />
        </div>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
