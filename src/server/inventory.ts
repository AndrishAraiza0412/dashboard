import "server-only";
import { and, asc, desc, eq, ilike, lte, or, sql } from "drizzle-orm";
import { categories, products, stockMovements } from "@/db/schema";
import type { Tx } from "@/server/db/rls";

export const PAGE_SIZE = 20;
export type StockFilter = "low" | "out";

export const listCategories = (tx: Tx, orgId: string) =>
  tx.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.orgId, orgId)).orderBy(asc(categories.name));

/** Filters, order and paging run in SQL; RLS plus the explicit org filter scope it to the caller's organization. */
export async function listProducts(
  tx: Tx,
  orgId: string,
  f: { q?: string; categoryId?: string; stock?: StockFilter; page: number },
) {
  const escaped = f.q?.replace(/[\\%_]/g, "\\$&");
  const where = and(
    eq(products.orgId, orgId),
    escaped ? or(ilike(products.name, `%${escaped}%`), ilike(products.sku, `%${escaped}%`)) : undefined,
    f.categoryId ? eq(products.categoryId, f.categoryId) : undefined,
    f.stock === "out" ? eq(products.stockQty, 0) : undefined,
    f.stock === "low" ? and(eq(products.active, true), lte(products.stockQty, products.reorderLevel)) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    tx
      .select({
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
      .orderBy(asc(products.name), asc(products.id))
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    tx.select({ total: sql<number>`count(*)::int` }).from(products).where(where),
  ]);
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
