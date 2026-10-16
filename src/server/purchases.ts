import "server-only";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { products, purchaseOrderItems, purchaseOrders, suppliers } from "@/db/schema";
import type { Tx } from "@/server/db/rls";

export const PURCHASE_STATUSES = { draft: "Borrador", ordered: "Pedido al proveedor", received: "Recibido", cancelled: "Cancelado" } as const;
export const PURCHASE_TONES = { draft: "neutral", ordered: "warning", received: "success", cancelled: "error" } as const;
export type PurchaseStatus = keyof typeof PURCHASE_STATUSES;

/** "OC-0007": purchase numbers are shown with a prefix so they never read like a sales order number. */
export const poNumber = (n: number | null) => (n ? `OC-${String(n).padStart(4, "0")}` : "Borrador");

export async function listPurchaseOrders(tx: Tx, orgId: string, f: { status?: PurchaseStatus; page: number; size: number }) {
  const where = and(eq(purchaseOrders.orgId, orgId), f.status ? eq(purchaseOrders.status, f.status) : undefined);
  const rows = await tx
    .select({
      rowCount: sql<number>`(count(*) over())::int`,
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      total: purchaseOrders.total,
      createdAt: purchaseOrders.createdAt,
      supplier: suppliers.name,
      items: sql<number>`(select coalesce(sum(qty), 0)::int from ${purchaseOrderItems} where ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, and(eq(suppliers.orgId, purchaseOrders.orgId), eq(suppliers.id, purchaseOrders.supplierId)))
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt), asc(purchaseOrders.id))
    .limit(f.size)
    .offset((f.page - 1) * f.size);
  const total = rows[0]?.rowCount ?? (f.page > 1 ? (await tx.select({ total: sql<number>`count(*)::int` }).from(purchaseOrders).where(where))[0].total : 0);
  return { rows, total };
}

export async function getPurchaseOrder(tx: Tx, orgId: string, id: string) {
  const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.id, id)));
  if (!po) return null;
  const lines = await tx
    .select({
      id: purchaseOrderItems.id,
      qty: purchaseOrderItems.qty,
      unitCost: purchaseOrderItems.unitCost,
      lineTotal: purchaseOrderItems.lineTotal,
      name: products.name,
      sku: products.sku,
      stockQty: products.stockQty,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, and(eq(products.orgId, purchaseOrderItems.orgId), eq(products.id, purchaseOrderItems.productId)))
    .where(and(eq(purchaseOrderItems.orgId, orgId), eq(purchaseOrderItems.purchaseOrderId, id)))
    .orderBy(asc(products.name));
  return { po, lines };
}

// suppliers are not paginated (a store works with a handful); add paging if one org passes a few hundred.
export const listSuppliers = (tx: Tx, orgId: string) =>
  tx.select().from(suppliers).where(eq(suppliers.orgId, orgId)).orderBy(asc(suppliers.name), asc(suppliers.id));

// capped at 500 active products for the picker; swap for a search box if a catalog outgrows it.
export const listPurchasableProducts = (tx: Tx, orgId: string) =>
  tx
    .select({ id: products.id, name: products.name, sku: products.sku, stockQty: products.stockQty, reorderLevel: products.reorderLevel })
    .from(products)
    .where(and(eq(products.orgId, orgId), eq(products.active, true)))
    .orderBy(asc(products.name))
    .limit(500);

/** Active products at or below their reorder level, with the quantity that brings them to twice that level. */
export const listRestockSuggestions = (tx: Tx, orgId: string) =>
  tx
    .select({ id: products.id, cost: products.cost, qty: sql<number>`greatest(${products.reorderLevel} * 2 - ${products.stockQty}, 1)::int` })
    .from(products)
    .where(and(eq(products.orgId, orgId), eq(products.active, true), lte(products.stockQty, products.reorderLevel)))
    .orderBy(asc(products.name))
    .limit(100);
