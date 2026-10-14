import { cn } from "@/lib/cn";

/**
 * Headline KPI. `value` and `delta` arrive pre-formatted (money stays a string until formatted).
 * Trend carries an arrow glyph + sign in text, never color alone.
 */
export function StatTile({
  label,
  value,
  delta,
  trend,
  hint,
}: {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
  hint?: string;
}) {
  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "–";
  return (
    <div className="rounded-lg border border-hairline bg-surface-card p-5">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="tabular mt-2 text-[28px] font-medium leading-none tracking-[-0.3px] text-ink">{value}</p>
      {(delta || hint) && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          {delta && (
            <span
              className={cn(
                "tabular inline-flex items-center gap-1 font-medium",
                trend === "up" && "text-success",
                trend === "down" && "text-error",
              )}
            >
              <span aria-hidden="true">{arrow}</span>
              {delta}
            </span>
          )}
          {hint && <span>{hint}</span>}
        </p>
      )}
    </div>
  );
}
