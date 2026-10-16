import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icons";

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
  icon,
}: {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
  hint?: string;
  icon?: IconName;
}) {
  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "–";
  return (
    <div data-tile className="group rounded-xl border border-hairline bg-surface-card p-5 shadow-[0_1px_0_rgb(0_0_0/0.03)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted">{label}</p>
        {icon && (
          <span data-tile-icon className="grid size-8 shrink-0 place-items-center rounded-lg bg-canvas text-primary-strong ring-1 ring-hairline">
            <Icon name={icon} />
          </span>
        )}
      </div>
      <p className="tabular mt-3 text-[32px] font-medium leading-none tracking-[-0.3px] text-ink">{value}</p>
      {(delta || hint) && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {delta && (
            <span
              className={cn(
                "tabular inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
                trend === "up" && "bg-success-bg text-success",
                trend === "down" && "bg-error-bg text-error",
                (!trend || trend === "flat") && "bg-canvas text-muted",
              )}
            >
              <span aria-hidden="true" className="text-[10px]">{arrow}</span>
              {delta}
            </span>
          )}
          {hint && <span>{hint}</span>}
        </p>
      )}
    </div>
  );
}
