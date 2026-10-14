import Link from "next/link";

/** Real links (URL state, works without JS). `href(page)` builds the address for a given page. */
export function Pagination({ page, pages, total, href }: { page: number; pages: number; total: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const cls = "rounded-md border border-hairline px-4 py-2 text-ink transition-colors duration-150 hover:bg-surface-soft";
  return (
    <nav aria-label="Paginación" className="mt-4 flex items-center justify-between text-[13px] text-muted">
      <span>
        Página {page} de {pages} · {total} {total === 1 ? "resultado" : "resultados"}
      </span>
      <span className="flex gap-2">
        {page > 1 && <Link href={href(page - 1)} className={cls}>Anterior</Link>}
        {page < pages && <Link href={href(page + 1)} className={cls}>Siguiente</Link>}
      </span>
    </nav>
  );
}
