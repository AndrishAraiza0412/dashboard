"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { money } from "@/lib/format";

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  price: string;
  stockQty: number;
  reorderLevel: number;
  active: boolean;
};

export function StockBadge({ p }: { p: Pick<ProductRow, "active" | "stockQty" | "reorderLevel"> }) {
  if (!p.active) return <Badge>Inactivo</Badge>;
  if (p.stockQty === 0) return <Badge tone="error">Agotado</Badge>;
  if (p.stockQty <= p.reorderLevel) return <Badge tone="warning">Stock bajo</Badge>;
  return <Badge tone="success">Disponible</Badge>;
}

/** Rows arrive already filtered, ordered and paged by the server, so column sorting is off. */
export function ProductsTable({ rows, base, currency }: { rows: ProductRow[]; base: string; currency: string }) {
  const columns: ColumnDef<ProductRow, unknown>[] = [
    { accessorKey: "sku", header: "SKU", enableSorting: false, meta: { nowrap: true } },
    {
      accessorKey: "name",
      header: "Producto",
      enableSorting: false,
      cell: ({ row }) => (
        <Link href={`${base}/${row.original.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { accessorKey: "category", header: "Categoría", enableSorting: false, cell: ({ row }) => row.original.category ?? "—" },
    { accessorKey: "price", header: "Precio", enableSorting: false, meta: { numeric: true }, cell: ({ row }) => money(row.original.price, currency) },
    { accessorKey: "stockQty", header: "Stock", enableSorting: false, meta: { numeric: true } },
    { id: "status", header: "Estado", enableSorting: false, cell: ({ row }) => <StockBadge p={row.original} /> },
  ];
  return <DataTable columns={columns} data={rows} caption="Productos" />;
}
