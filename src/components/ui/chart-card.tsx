// Card wrapper for a chart: title, optional description and footer.
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
    <section className="min-w-0 rounded-xl border border-hairline bg-canvas p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <h2 className="text-[17px] font-medium text-ink">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
      {footer && <div className="mt-4 text-[13px] text-muted">{footer}</div>}
    </section>
  );
}
