"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type Point = { label: string; value: number };

/**
 * Single-series line: 2px stroke, recessive grid, surface-ringed markers on hover, tooltip on every point.
 * Takes currency (not a formatter) so it can be rendered from a Server Component.
 */
export function RevenueLine({ data, currency, locale = "es-MX" }: { data: Point[]; currency: string; locale?: string }) {
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 });
  const format = (n: number) => money.format(n);
  return (
    <div role="img" aria-label="Gráfica de línea de ingresos" className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} />
          <YAxis
            width={56}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
            tickFormatter={(v: number) => format(v)}
          />
          <Tooltip
            formatter={(v) => [format(Number(v)), "Ingresos"]}
            contentStyle={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 8, color: "var(--ink)" }}
            cursor={{ stroke: "var(--hairline)" }}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, stroke: "var(--canvas)", strokeWidth: 2, fill: "var(--chart-1)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
