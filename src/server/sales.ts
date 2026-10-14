import "server-only";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { customers, orderItems, orders, products } from "@/db/schema";
import type { Tx } from "@/server/db/rls";

export const STATUSES = { draft: "Borrador", confirmed: "Confirmado", fulfilled: "Completado", cancelled: "Cancelado" } as const;
export const TONES = { draft: "neutral", confirmed: "warning", fulfilled: "success", cancelled: "error" } as const;
export type Status = keyof typeof STATUSES;

export const ORDER_SORTS = {
  date_desc: "Más recientes",
  date_asc: "Más antiguos",
  total_desc: "Total (mayor a menor)",
  total_asc: "Total (menor a mayor)",
} as const;
export type OrderSort = keyof typeof ORDER_SORTS;
const ORDER_BY = {
  date_desc: desc(orders.createdAt),
  date_asc: asc(orders.createdAt),
  total_desc: desc(orders.total),
  total_asc: asc(orders.total),
} as const;

/** `from`/`to` are local days (YYYY-MM-DD) in the organization's time zone, inclusive. */
export async function listOrders(
  tx: Tx,
  orgId: string,
  f: { status?: Status; customerId?: string; from?: string; to?: string; sort?: OrderSort; timezone: string; page: number; size: number },
) {
  const midnight = (d: string, plusDays = 0) => sql`((${d}::date + ${plusDays}::int)::timestamp at time zone ${f.timezone})`;
  const where = and(
    eq(orders.orgId, orgId),
    f.status ? eq(orders.status, f.status) : undefined,
    f.customerId ? eq(orders.customerId, f.customerId) : undefined,
    f.from ? sql`${orders.createdAt} >= ${midnight(f.from)}` : undefined,
    f.to ? sql`${orders.createdAt} < ${midnight(f.to, 1)}` : undefined,
  );
  const rows = await tx
      .select({ rowCount: sql<number>`(count(*) over())::int`, id: orders.id, number: orders.number, status: orders.status, total: orders.total, createdAt: orders.createdAt, customer: customers.name })
      .from(orders)
      .leftJoin(customers, and(eq(customers.orgId, orders.orgId), eq(customers.id, orders.customerId)))
      .where(where)
      .orderBy(ORDER_BY[f.sort ?? "date_desc"], asc(orders.id))
      .limit(f.size)
      .offset((f.page - 1) * f.size);
  const total = rows[0]?.rowCount ?? (f.page > 1 ? (await tx.select({ total: sql<number>`count(*)::int` }).from(orders).where(where))[0].total : 0);
  return { rows, total };
}

export const CUSTOMER_STATUSES = { all: "Todos", active: "Activos", inactive: "Inactivos" } as const;
export type CustomerStatus = keyof typeof CUSTOMER_STATUSES;

// customers are not paginated (the list is a screenful of inline forms); add paging if one org passes a few hundred.
export function listCustomers(tx: Tx, orgId: string, f: { q?: string; status?: CustomerStatus } = {}) {
  const escaped = f.q?.replace(/[\\%_]/g, "\\$&");
  return tx
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.orgId, orgId),
        escaped ? or(ilike(customers.name, `%${escaped}%`), ilike(customers.email, `%${escaped}%`), ilike(customers.phone, `%${escaped}%`)) : undefined,
        f.status === "active" ? eq(customers.active, true) : f.status === "inactive" ? eq(customers.active, false) : undefined,
      ),
    )
    .orderBy(asc(customers.name), asc(customers.id));
}

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
