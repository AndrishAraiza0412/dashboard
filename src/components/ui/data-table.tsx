"use client";

import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useState } from "react";
import { cn } from "@/lib/cn";

type Meta = { numeric?: boolean; nowrap?: boolean } | undefined;

/** Client-side sort for small lists. Server-side paging/filtering is added per screen (Phases 3-4). */
export function DataTable<T>({ columns, data, caption }: { columns: ColumnDef<T, unknown>[]; data: T[]; caption: string }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    // Scrolls inside its container so the page never scrolls horizontally on mobile.
    <div className="overflow-x-auto rounded-lg border border-hairline bg-canvas">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-soft">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                    className={cn("px-4 py-3 text-[13px] font-medium text-muted", (h.column.columnDef.meta as Meta)?.numeric && "text-right")}
                  >
                    {h.column.getCanSort() ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-ink">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <span aria-hidden="true">{sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : ""}</span>
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t border-hairline-soft hover:bg-surface-soft/60">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={cn("px-4 py-3 text-ink", (cell.column.columnDef.meta as Meta)?.nowrap && "whitespace-nowrap", (cell.column.columnDef.meta as Meta)?.numeric && "tabular whitespace-nowrap text-right")}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
