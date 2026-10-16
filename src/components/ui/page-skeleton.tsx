/** Shown while a page's data loads, so a view change responds at once instead of showing a blank area. */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando" className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-56 rounded-md bg-surface-card" />
        <div className="h-4 w-36 rounded-md bg-surface-card" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-12 rounded-xl bg-surface-card" />
        ))}
      </div>
    </div>
  );
}
