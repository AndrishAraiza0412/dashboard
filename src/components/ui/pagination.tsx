import Link from "next/link";
import { Icon } from "@/components/ui/icons";

/** Real links (URL state, works without JS). `href(page)` builds the address for a given page. */
export function Pagination({ page, pages, total, href }: { page: number; pages: number; total: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const cls = "inline-flex items-center gap-1 rounded-md border border-hairline bg-canvas px-3 py-2 text-ink shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors duration-150 hover:bg-surface-soft";
  return (
    <nav aria-label="Paginación" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
      <span>
        Página {page} de {pages} · {total} {total === 1 ? "resultado" : "resultados"}
      </span>
      <span className="flex gap-2">
        {page > 1 && <Link href={href(page - 1)} className={cls}><Icon name="chevronLeft" className="size-4" />Anterior</Link>}
        {page < pages && <Link href={href(page + 1)} className={cls}>Siguiente<Icon name="chevronRight" className="size-4" /></Link>}
      </span>
    </nav>
  );
}
