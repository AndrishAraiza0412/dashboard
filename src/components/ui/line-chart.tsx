"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type Point = { label: string; value: number; previous?: number };

/**
 * Revenue over time: 2px stroke, recessive grid, tooltip on every point. With `previous` it adds the comparison
 * period as a thinner dashed line (one axis, same unit), and a legend that tells them apart by line style, not color
 * alone. Takes currency (not a formatter) so it can be rendered from a Server Component.
 */
export function RevenueLine({ data, currency, locale = "es-MX", compare = false }: { data: Point[]; currency: string; locale?: string; compare?: boolean }) {
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  const exact = new Intl.NumberFormat(locale, { style: "currency", currency });
  return (
    <figure>
      {compare && (
        <figcaption className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-2">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--chart-1)" strokeWidth="2" /></svg>
            Periodo actual
          </span>
          <span className="inline-flex items-center gap-2">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="var(--chart-axis)" strokeWidth="1.5" strokeDasharray="5 4" /></svg>
            Periodo anterior
          </span>
        </figcaption>
      )}
      <div role="img" aria-label="Gráfica de línea de ingresos" className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="0" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} />
            <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} tickFormatter={(v: number) => money.format(v)} />
            <Tooltip
              formatter={(v, name) => [exact.format(Number(v)), name]}
              contentStyle={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 10, color: "var(--ink)", boxShadow: "0 8px 24px rgb(0 0 0 / 0.08)" }}
              cursor={{ stroke: "var(--hairline)" }}
            />
            {compare && (
              <Line type="linear" dataKey="previous" name="Periodo anterior" stroke="var(--chart-axis)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, stroke: "var(--canvas)", strokeWidth: 2, fill: "var(--chart-axis)" }} isAnimationActive={false} />
            )}
            <Area type="linear" dataKey="value" fill="url(#revenue-fill)" stroke="none" legendType="none" tooltipType="none" isAnimationActive={false} />
            <Line type="linear" dataKey="value" name="Periodo actual" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "var(--canvas)", strokeWidth: 2, fill: "var(--chart-1)" }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Ingresos por periodo</caption>
        <thead><tr><th>Periodo</th><th>Actual</th>{compare && <th>Anterior</th>}</tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}><td>{d.label}</td><td>{exact.format(d.value)}</td>{compare && <td>{exact.format(d.previous ?? 0)}</td>}</tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
