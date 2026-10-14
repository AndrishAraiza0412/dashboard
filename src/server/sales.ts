import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { customers, orderItems, orders, products } from "@/db/schema";
import type { Tx } from "@/server/db/rls";

export const ORDERS_PAGE = 20;
export const STATUSES = { draft: "Borrador", confirmed: "Confirmado", fulfilled: "Completado", cancelled: "Cancelado" } as const;
export const TONES = { draft: "neutral", confirmed: "warning", fulfilled: "success", cancelled: "error" } as const;
export type Status = keyof typeof STATUSES;

export async function listOrders(tx: Tx, orgId: string, f: { status?: Status; page: number }) {
  const where = and(eq(orders.orgId, orgId), f.status ? eq(orders.status, f.status) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    tx
      .select({ id: orders.id, number: orders.number, status: orders.status, total: orders.total, createdAt: orders.createdAt, customer: customers.name })
      .from(orders)
      .leftJoin(customers, and(eq(customers.orgId, orders.orgId), eq(customers.id, orders.customerId)))
      .where(where)
      .orderBy(desc(orders.createdAt), asc(orders.id))
      .limit(ORDERS_PAGE)
      .offset((f.page - 1) * ORDERS_PAGE),
    tx.select({ total: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);
  return { rows, total };
}

export const listCustomers = (tx: Tx, orgId: string) =>
  tx.select().from(customers).where(eq(customers.orgId, orgId)).orderBy(asc(customers.name));

export async function getOrder(tx: Tx, orgId: string, id: string) {
  const [order] = await tx.select().from(orders).where(and(eq(orders.orgId, orgId), eq(orders.id, id)));
  if (!order) return null;
  const lines = await tx
    .select({ id: orderItems.id, qty: orderItems.qty, unitPrice: orderItems.unitPrice, lineTotal: orderItems.lineTotal, name: products.name, sku: products.sku })
    .from(orderItems)
    .innerJoin(products, and(eq(products.orgId, orderItems.orgId), eq(products.id, orderItems.productId)))
    .where(and(eq(orderItems.orgId, orgId), eq(orderItems.orderId, id)))
    .orderBy(asc(products.name));
  return { order, lines };
}

// capped at 500 active products for the picker; swap for a search box if a catalog outgrows it.
export const listActiveProducts = (tx: Tx, orgId: string) =>
  tx
    .select({ id: products.id, name: products.name, sku: products.sku, stockQty: products.stockQty })
    .from(products)
    .where(and(eq(products.orgId, orgId), eq(products.active, true)))
    .orderBy(asc(products.name))
    .limit(500);
