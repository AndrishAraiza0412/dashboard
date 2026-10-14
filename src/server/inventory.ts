import "server-only";
import { and, asc, desc, eq, ilike, lte, or, sql } from "drizzle-orm";
import { categories, products, stockMovements } from "@/db/schema";
import type { Tx } from "@/server/db/rls";

export type StockFilter = "low" | "out";
export const PRODUCT_SORTS = {
  name_asc: "Nombre (A–Z)",
  name_desc: "Nombre (Z–A)",
  price_asc: "Precio (menor a mayor)",
  price_desc: "Precio (mayor a menor)",
  stock_asc: "Stock (menor a mayor)",
  stock_desc: "Stock (mayor a menor)",
  newest: "Más recientes",
} as const;
export type ProductSort = keyof typeof PRODUCT_SORTS;
export const PRODUCT_STATUSES = { all: "Todos", active: "Activos", inactive: "Inactivos" } as const;
export type ProductStatus = keyof typeof PRODUCT_STATUSES;

const ORDER = {
  name_asc: asc(products.name),
  name_desc: desc(products.name),
  price_asc: asc(products.price),
  price_desc: desc(products.price),
  stock_asc: asc(products.stockQty),
  stock_desc: desc(products.stockQty),
  newest: desc(products.createdAt),
} as const;

export const listCategories = (tx: Tx, orgId: string) =>
  tx.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.orgId, orgId)).orderBy(asc(categories.name));

/** Filters, order and paging run in SQL; RLS plus the explicit org filter scope it to the caller's organization. */
export async function listProducts(
  tx: Tx,
  orgId: string,
  f: { q?: string; categoryId?: string; stock?: StockFilter; status?: ProductStatus; sort?: ProductSort; page: number; size: number },
) {
  const escaped = f.q?.replace(/[\\%_]/g, "\\$&");
  const where = and(
    eq(products.orgId, orgId),
    escaped ? or(ilike(products.name, `%${escaped}%`), ilike(products.sku, `%${escaped}%`)) : undefined,
    f.categoryId ? eq(products.categoryId, f.categoryId) : undefined,
    f.stock === "out" ? eq(products.stockQty, 0) : undefined,
    f.stock === "low" ? and(eq(products.active, true), lte(products.stockQty, products.reorderLevel)) : undefined,
    f.status === "active" ? eq(products.active, true) : f.status === "inactive" ? eq(products.active, false) : undefined,
  );
  // Rows and total in one statement (count over the full filtered set): every statement is a round trip.
  const rows = await tx
      .select({
        rowCount: sql<number>`(count(*) over())::int`,
        id: products.id,
        sku: products.sku,
        name: products.name,
        category: categories.name,
        price: products.price,
        stockQty: products.stockQty,
        reorderLevel: products.reorderLevel,
        active: products.active,
      })
      .from(products)
      .leftJoin(categories, and(eq(categories.orgId, products.orgId), eq(categories.id, products.categoryId)))
      .where(where)
      .orderBy(ORDER[f.sort ?? "name_asc"], asc(products.id))
      .limit(f.size)
      .offset((f.page - 1) * f.size);
  // A page past the end has no rows to carry the count: ask for it only then.
  const total = rows[0]?.rowCount ?? (f.page > 1 ? (await tx.select({ total: sql<number>`count(*)::int` }).from(products).where(where))[0].total : 0);
  return { rows, total };
}

export async function getProduct(tx: Tx, orgId: string, id: string) {
  const [p] = await tx.select().from(products).where(and(eq(products.orgId, orgId), eq(products.id, id)));
  return p;
}

export const listMovements = (tx: Tx, orgId: string, productId: string) =>
  tx
    .select({ id: stockMovements.id, delta: stockMovements.delta, reason: stockMovements.reason, note: stockMovements.note, createdAt: stockMovements.createdAt })
    .from(stockMovements)
    .where(and(eq(stockMovements.orgId, orgId), eq(stockMovements.productId, productId)))
    .orderBy(desc(stockMovements.createdAt))
    .limit(50);
