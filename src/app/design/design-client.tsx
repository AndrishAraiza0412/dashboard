"use client";

// Client part of the /design page: a living style guide that renders the UI components (table, badges, dialogs, toasts) with sample data.
import type { ColumnDef } from "@tanstack/react-table";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

type Row = { sku: string; name: string; stock: number; price: string };

const rows: Row[] = [
  { sku: "CAF-001", name: "Café de olla 500 g", stock: 42, price: "$129" },
  { sku: "TAZ-014", name: "Taza de barro", stock: 3, price: "$89" },
  { sku: "FIL-200", name: "Filtros V60 (100)", stock: 18, price: "$215" },
];

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "sku", header: "SKU" },
  { accessorKey: "name", header: "Producto" },
  {
    accessorKey: "stock",
    header: "Stock",
    cell: ({ row }) => (row.original.stock <= 5 ? <Badge tone="warning">{row.original.stock} · bajo</Badge> : row.original.stock),
    meta: { numeric: true },
  },
  { accessorKey: "price", header: "Precio", meta: { numeric: true } },
];

function Inner() {
  const toast = useToast();
  return (
    <section aria-labelledby="table-h" className="rounded-lg border border-hairline bg-canvas p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
        <h2 id="table-h" className="text-base font-medium text-ink">Tabla y diálogo</h2>
        <div className="flex gap-2">
          <Button onClick={() => toast("Producto guardado")}>Mostrar aviso</Button>
          <ConfirmDialog
            trigger="Eliminar…"
            title="¿Eliminar producto?"
            description="Esta acción no se puede deshacer."
            confirmLabel="Eliminar"
            destructive
            onConfirm={() => toast("Producto eliminado")}
          />
        </div>
      </div>
      {/* TanStack Table reads Date.now(); with Cache Components, tables must sit inside Suspense. */}
      <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-surface-card" aria-hidden="true" />}>
        <DataTable columns={columns} data={rows} caption="Productos de ejemplo" />
      </Suspense>
    </section>
  );
}

export function DesignClient() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  );
}
