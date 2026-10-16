"use client";

import { useId } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Vertical bars for ordered categories (e.g. weekdays): baseline at zero, 4px rounded tops, tooltip on every bar. */
export function ColumnChart({ data, currency, label, locale = "es-MX" }: { data: { label: string; value: number; extra?: string }[]; currency: string; label: string; locale?: string }) {
  const short = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  const exact = new Intl.NumberFormat(locale, { style: "currency", currency });
  const fill = `bar-${useId()}`;
  return (
    <figure>
      <div role="img" aria-label={label} className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {/* --bar-top/--bar-bottom are both --chart-1 unless the glass style is on (tokens.css) */}
              <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--bar-top)" />
                <stop offset="100%" stopColor="var(--bar-bottom)" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} />
            <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} tickFormatter={(v: number) => short.format(v)} />
            <Tooltip
              formatter={(v) => [exact.format(Number(v)), "Ingresos"]}
              contentStyle={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 8, color: "var(--ink)" }}
              cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
            />
            <Bar dataKey="value" fill={`url(#${fill})`} radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th>Día</th><th>Ingresos</th>{data.some((d) => d.extra) && <th>Pedidos</th>}</tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}><td>{d.label}</td><td>{exact.format(d.value)}</td>{d.extra !== undefined && <td>{d.extra}</td>}</tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
