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
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-hairline px-6 py-12 text-center">
      <h2 className="text-base font-medium text-ink">{title}</h2>
      {description && <p className="max-w-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}
