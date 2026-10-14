import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/ui/chart-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { RevenueLine } from "@/components/ui/line-chart";
import { DesignClient } from "./design-client";

// Component gallery for visual review. Dev only.
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  const series = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((label, i) => ({
    label,
    value: [12400, 15800, 11200, 19300, 22100, 27800, 18900][i],
  }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Sistema de diseño"
        description="Galería de componentes para revisión visual. Solo en desarrollo."
        actions={<Button variant="primary">Acción principal</Button>}
      />

      <section aria-labelledby="kpis" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="kpis" className="sr-only">KPIs</h2>
        <StatTile label="Ingresos" value={money.format(127500)} delta="12.4%" trend="up" hint="vs. periodo anterior" />
        <StatTile label="Pedidos" value="214" delta="3.1%" trend="down" hint="vs. periodo anterior" />
        <StatTile label="Ticket promedio" value={money.format(596)} delta="0%" trend="flat" />
        <StatTile label="Stock bajo" value="7" hint="productos por reabastecer" />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Ingresos por día" description="Últimos 7 días" footer="Pasa el cursor sobre la línea para ver cada valor.">
            <RevenueLine data={series} currency="MXN" />
          </ChartCard>
        </div>
        <ChartCard title="Estados">
          <div className="flex flex-wrap gap-2">
            <Badge>Borrador</Badge>
            <Badge tone="success">Confirmado</Badge>
            <Badge tone="warning">Stock bajo</Badge>
            <Badge tone="error">Cancelado</Badge>
            <Badge tone="coral">NUEVO</Badge>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary">Primario</Button>
            <Button>Secundario</Button>
            <Button variant="ghost">Fantasma</Button>
            <Button variant="primary" disabled>Deshabilitado</Button>
          </div>
        </ChartCard>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4">
        <DesignClient />
        <EmptyState
          title="Aún no hay productos"
          description="Crea tu primer producto para empezar a controlar el inventario."
          action={<Button variant="primary">Crear producto</Button>}
        />
      </div>
    </main>
  );
}
