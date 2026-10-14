"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { OrgContext, Role } from "@/server/db/with-org";

/** Dot that appears (after 100 ms, so quick navigations never flash it) while the clicked link's page loads. */
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`ml-2 inline-block size-1.5 rounded-full bg-primary-strong transition-opacity duration-150 ${pending ? "animate-pulse opacity-100 delay-100" : "opacity-0"}`} />;
}

type NavItem = { href: string; label: string; module?: "inventory" | "sales"; minRole?: Role };

// Entries are added as each phase lands: inventory, sales, settings.
const NAV: NavItem[] = [
  { href: "", label: "Resumen" },
  { href: "/inventory", label: "Inventario", module: "inventory" },
  { href: "/sales", label: "Ventas", module: "sales" },
  { href: "/activity", label: "Actividad", minRole: "admin" },
  { href: "/settings", label: "Ajustes" },
];
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

export function Sidebar({ ctx, orgs }: { ctx: OrgContext; orgs: { slug: string; name: string }[] }) {
  const path = usePathname();
  const items = NAV.filter((i) => (!i.module || ctx.modules.includes(i.module)) && RANK[ctx.role] >= RANK[i.minRole ?? "viewer"]);
  return (
    <aside className="border-b border-hairline bg-surface-soft md:w-60 md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-2 px-4 py-3 md:block md:py-5">
        {orgs.length > 1 ? (
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-ink [&::-webkit-details-marker]:hidden">
              <span className="truncate">{ctx.name}</span>
              <span aria-hidden="true">▾</span>
            </summary>
            <ul className="absolute z-10 mt-2 w-56 rounded-md border border-hairline bg-canvas p-1 shadow-sm">
              {orgs.map((o) => (
                <li key={o.slug}>
                  <Link href={`/o/${o.slug}`} className="block rounded-md px-3 py-2 text-[13px] text-ink hover:bg-surface-card" aria-current={o.slug === ctx.slug ? "true" : undefined}>
                    {o.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="truncate font-medium text-ink">{ctx.name}</p>
        )}
      </div>
      <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
        {items.map((i) => {
          const href = `/o/${ctx.slug}${i.href}`;
          const current = i.href === "" ? path === href : path === href || path.startsWith(`${href}/`);
          return (
            <Link
              key={i.href}
              href={href}
              aria-current={current ? "page" : undefined}
              className="whitespace-nowrap rounded-md px-3 py-2 text-[14px] font-medium text-body hover:bg-surface-card aria-[current=page]:bg-surface-card aria-[current=page]:text-ink"
            >
              {i.label}
              <Pending />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
