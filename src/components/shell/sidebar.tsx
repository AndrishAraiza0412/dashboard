"use client";

import Link, { useLinkStatus } from "next/link";
import type { ModuleId } from "@/lib/modules";
import { usePathname } from "next/navigation";
import { BrandMark, Icon, type IconName } from "@/components/ui/icons";
import type { OrgContext, Role } from "@/server/db/with-org";

/** Dot that appears (after 100 ms, so quick navigations never flash it) while the clicked link's page loads. */
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`ml-2 inline-block size-1.5 rounded-full bg-primary-strong transition-opacity duration-150 ${pending ? "animate-pulse opacity-100 delay-100" : "opacity-0"}`} />;
}

type NavItem = { href: string; label: string; icon: IconName; module?: ModuleId; minRole?: Role };

// Entries are added as each phase lands: inventory, sales, settings.
const NAV: NavItem[] = [
  { href: "", label: "Resumen", icon: "dashboard" },
  { href: "/inventory", label: "Inventario", icon: "box", module: "inventory" },
  { href: "/sales", label: "Ventas", icon: "cart", module: "sales" },
  { href: "/purchases", label: "Compras", icon: "truck", module: "purchases" },
  { href: "/activity", label: "Actividad", icon: "activity", minRole: "admin" },
  { href: "/settings", label: "Ajustes", icon: "settings" },
];
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

export function Sidebar({ ctx, orgs }: { ctx: OrgContext; orgs: { slug: string; name: string }[] }) {
  const path = usePathname();
  const items = NAV.filter((i) => (!i.module || ctx.modules.includes(i.module)) && RANK[ctx.role] >= RANK[i.minRole ?? "viewer"]);
  return (
    <aside className="border-b border-hairline bg-surface-soft md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
      <div className="flex items-center gap-2.5 px-4 py-3 md:py-5">
        <BrandMark />
        {orgs.length > 1 ? (
          <details className="relative min-w-0">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-ink transition-colors hover:bg-surface-card [&::-webkit-details-marker]:hidden">
              <span className="truncate">{ctx.name}</span>
              <Icon name="chevronDown" className="size-4 text-muted" />
            </summary>
            <ul className="absolute z-30 mt-2 w-56 rounded-lg border border-hairline bg-canvas p-1 shadow-lg">
              {orgs.map((o) => (
                <li key={o.slug}>
                  <Link href={`/o/${o.slug}`} className="block rounded-md px-3 py-2 text-[13px] text-ink hover:bg-surface-card aria-[current=true]:font-medium aria-[current=true]:text-primary-text" aria-current={o.slug === ctx.slug ? "true" : undefined}>
                    {o.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="min-w-0 truncate font-medium text-ink">{ctx.name}</p>
        )}
      </div>
      <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pb-0">
        {items.map((i) => {
          const href = `/o/${ctx.slug}${i.href}`;
          const current = i.href === "" ? path === href : path === href || path.startsWith(`${href}/`);
          return (
            <Link
              key={i.href}
              href={href}
              aria-current={current ? "page" : undefined}
              className="group relative flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-[14px] font-medium text-body transition-colors duration-150 hover:bg-surface-card aria-[current=page]:bg-surface-card aria-[current=page]:text-ink before:absolute before:rounded-full before:bg-primary-strong before:opacity-0 before:transition-opacity aria-[current=page]:before:opacity-100 before:inset-x-3 before:bottom-0 before:h-[2px] md:before:inset-x-auto md:before:inset-y-1.5 md:before:-left-3 md:before:h-auto md:before:w-[3px]"
            >
              <Icon name={i.icon} className="size-[18px] shrink-0 text-muted transition-colors group-aria-[current=page]:text-primary-strong" />
              {i.label}
              <Pending />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
