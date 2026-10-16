/** Horizontal bars as plain HTML: the value is always printed, so the bar is never the only encoding. */
export function BarList({ items, format }: { items: { name: string; value: string }[]; format: (v: string) => string }) {
  const max = Math.max(...items.map((i) => Number(i.value)), 0) || 1;
  return (
    <ul className="space-y-4">
      {items.map((i, n) => (
        <li key={i.name}>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="flex min-w-0 items-baseline gap-2"><span aria-hidden="true" className="tabular w-4 shrink-0 text-[12px] text-muted">{n + 1}</span><span className="truncate text-ink">{i.name}</span></span>
            <span className="tabular shrink-0 font-medium text-ink">{format(i.value)}</span>
          </div>
          <div aria-hidden="true" className="mt-1.5 ml-6 h-2 overflow-hidden rounded-full bg-surface-card">
            <div className="bar-grow h-2 rounded-full bg-gradient-to-r from-[var(--chart-1)]/70 to-[var(--chart-1)]" style={{ width: `${(Number(i.value) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
