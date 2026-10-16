import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";

// RLS policies, grants, helpers, SECURITY DEFINER functions and triggers live in the
// custom SQL migrations under drizzle/ — one reviewable place for security.
//
// Drizzle names every non-generated column in INSERT (using DEFAULT), and Postgres needs INSERT
// privilege on every named column. Columns that must not be forgeable (status, total, stock_qty,
// invited_by, ...) are therefore granted but overwritten by BEFORE INSERT triggers.

export const memberRole = pgEnum("member_role", ["admin", "member", "viewer"]);
export const orderStatus = pgEnum("order_status", ["draft", "confirmed", "fulfilled", "cancelled"]);
export const movementReason = pgEnum("movement_reason", ["sale", "sale_cancel", "restock", "adjustment", "purchase"]);
export const purchaseStatus = pgEnum("purchase_status", ["draft", "ordered", "received", "cancelled"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

export const organizations = pgTable(
  "organizations",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    currency: text().notNull().default("MXN"),
    timezone: text().notNull().default("America/Mexico_City"),
    enabledModules: text("enabled_modules")
      .array()
      .notNull()
      .default(sql`'{inventory,sales,purchases}'::text[]`),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    // keep in sync with MODULES (src/lib/modules.ts)
    check("organizations_modules_known", sql`${t.enabledModules} <@ '{inventory,sales,purchases}'::text[]`),
    check(
      "organizations_sales_needs_inventory",
      sql`not ('sales' = any(${t.enabledModules})) or 'inventory' = any(${t.enabledModules})`,
    ),
    check(
      "organizations_purchases_needs_inventory",
      sql`not ('purchases' = any(${t.enabledModules})) or 'inventory' = any(${t.enabledModules})`,
    ),
  ],
);

export const orgCounters = pgTable("org_counters", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  nextOrderNo: integer("next_order_no").notNull().default(1),
  nextPurchaseNo: integer("next_purchase_no").notNull().default(1),
});

export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
});

export const profiles = pgTable("profiles", {
  id: uuid()
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  email: text(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: memberRole().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index("memberships_user_org_idx").on(t.userId, t.orgId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    email: text().notNull(),
    role: memberRole().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    uniqueIndex("invitations_open_email_key")
      .on(t.orgId, sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    name: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    unique("categories_org_id_id_key").on(t.orgId, t.id),
    unique("categories_org_name_key").on(t.orgId, t.name),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    sku: text().notNull(),
    name: text().notNull(),
    categoryId: uuid("category_id"),
    price: money("price").notNull().default("0"),
    cost: money("cost").notNull().default("0"),
    stockQty: integer("stock_qty").notNull().default(0),
    reorderLevel: integer("reorder_level").notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.categoryId], foreignColumns: [categories.orgId, categories.id] }),
    unique("products_org_id_id_key").on(t.orgId, t.id),
    unique("products_org_sku_key").on(t.orgId, t.sku),
    check("products_price_nonneg", sql`${t.price} >= 0`),
    check("products_cost_nonneg", sql`${t.cost} >= 0`),
    check("products_stock_nonneg", sql`${t.stockQty} >= 0`),
    check("products_reorder_nonneg", sql`${t.reorderLevel} >= 0`),
    index("products_org_name_idx").on(t.orgId, t.name),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    unique("customers_org_id_id_key").on(t.orgId, t.id),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    number: integer(),
    customerId: uuid("customer_id"),
    status: orderStatus().notNull().default("draft"),
    total: money("total").notNull().default("0"),
    notes: text(),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.customerId], foreignColumns: [customers.orgId, customers.id] }),
    unique("orders_org_id_id_key").on(t.orgId, t.id),
    unique("orders_org_number_key").on(t.orgId, t.number),
    index("orders_org_confirmed_idx").on(t.orgId, t.confirmedAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    orderId: uuid("order_id").notNull(),
    productId: uuid("product_id").notNull(),
    qty: integer().notNull(),
    unitPrice: money("unit_price").notNull(),
    lineTotal: money("line_total").generatedAlwaysAs(sql`qty * unit_price`),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.orderId], foreignColumns: [orders.orgId, orders.id] }),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id] }),
    unique("order_items_order_product_key").on(t.orderId, t.productId),
    check("order_items_qty_positive", sql`${t.qty} > 0`),
    check("order_items_price_nonneg", sql`${t.unitPrice} >= 0`),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    unique("suppliers_org_id_id_key").on(t.orgId, t.id),
  ],
);

// Purchase orders to suppliers: draft -> ordered -> received (stock goes up only on receipt).
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    number: integer(),
    supplierId: uuid("supplier_id"),
    status: purchaseStatus().notNull().default("draft"),
    total: money("total").notNull().default("0"),
    notes: text(),
    createdAt: createdAt(),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.supplierId], foreignColumns: [suppliers.orgId, suppliers.id] }),
    unique("purchase_orders_org_id_id_key").on(t.orgId, t.id),
    unique("purchase_orders_org_number_key").on(t.orgId, t.number),
    index("purchase_orders_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    productId: uuid("product_id").notNull(),
    qty: integer().notNull(),
    unitCost: money("unit_cost").notNull(),
    lineTotal: money("line_total").generatedAlwaysAs(sql`qty * unit_cost`),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.purchaseOrderId], foreignColumns: [purchaseOrders.orgId, purchaseOrders.id] }),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id] }),
    unique("purchase_order_items_po_product_key").on(t.purchaseOrderId, t.productId),
    check("purchase_order_items_qty_positive", sql`${t.qty} > 0`),
    check("purchase_order_items_cost_nonneg", sql`${t.unitCost} >= 0`),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    productId: uuid("product_id").notNull(),
    delta: integer().notNull(),
    reason: movementReason().notNull(),
    orderId: uuid("order_id"),
    purchaseOrderId: uuid("purchase_order_id"),
    note: text(),
    createdBy: uuid("created_by").default(sql`auth.uid()`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id] }),
    foreignKey({ columns: [t.orgId, t.orderId], foreignColumns: [orders.orgId, orders.id] }),
    foreignKey({ columns: [t.orgId, t.purchaseOrderId], foreignColumns: [purchaseOrders.orgId, purchaseOrders.id] }),
    check("stock_movements_delta_nonzero", sql`${t.delta} <> 0`),
    index("stock_movements_product_idx").on(t.productId, t.createdAt),
  ],
);

// No FK on org_id: the audit trail must survive an organization being deleted.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    orgId: uuid("org_id"),
    actorId: uuid("actor_id"),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text("entity_id"),
    diff: jsonb(),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_org_created_idx").on(t.orgId, t.createdAt)],
);
