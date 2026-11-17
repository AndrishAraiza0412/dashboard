// Empty state: icon, title, optional description and action.
import { Icon } from "@/components/ui/icons";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-hairline bg-surface-soft/40 px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-surface-card text-muted ring-1 ring-hairline">
        <Icon name="inbox" className="size-5" />
      </span>
      <h2 className="text-base font-medium text-ink">{title}</h2>
      {description && <p className="max-w-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}
