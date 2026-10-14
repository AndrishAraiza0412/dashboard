export function ChartCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-hairline bg-canvas p-6">
      <h2 className="text-base font-medium text-ink">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
      {footer && <div className="mt-4 text-[13px] text-muted">{footer}</div>}
    </section>
  );
}
