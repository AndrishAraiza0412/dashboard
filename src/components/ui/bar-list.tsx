/** Horizontal bars as plain HTML: the value is always printed, so the bar is never the only encoding. */
export function BarList({ items, format }: { items: { name: string; value: string }[]; format: (v: string) => string }) {
  const max = Math.max(...items.map((i) => Number(i.value)), 0) || 1;
  return (
    <ul className="space-y-4">
      {items.map((i) => (
        <li key={i.name}>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="min-w-0 truncate text-ink">{i.name}</span>
            <span className="tabular shrink-0 text-ink">{format(i.value)}</span>
          </div>
          <div aria-hidden="true" className="mt-1.5 h-2 rounded-r-full bg-surface-card">
            <div className="h-2 rounded-r-full bg-[var(--chart-1)]" style={{ width: `${(Number(i.value) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
