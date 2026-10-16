// Turns an audit_log row into Spanish text. Pure functions, so they can be tested without a database.
export const ENTITIES = {
  products: "Producto", categories: "Categoría", customers: "Cliente", orders: "Pedido", order_items: "Línea de pedido",
  stock_movements: "Movimiento de stock", suppliers: "Proveedor", purchase_orders: "Orden de compra", purchase_order_items: "Línea de compra", memberships: "Miembro", invitations: "Invitación", organizations: "Organización",
} as const;
export type Entity = keyof typeof ENTITIES;
export const ACTIONS = { insert: "creó", update: "modificó", delete: "eliminó" } as const;
export type Action = keyof typeof ACTIONS;

const FIELDS: Record<string, string> = {
  name: "nombre", sku: "SKU", price: "precio", cost: "costo", stock_qty: "stock", reorder_level: "nivel de aviso", active: "activo",
  category_id: "categoría", customer_id: "cliente", status: "estado", notes: "notas", total: "total", number: "número",
  email: "correo", phone: "teléfono", role: "rol", currency: "moneda", timezone: "zona horaria", enabled_modules: "módulos",
  suspended_at: "suspensión", qty: "cantidad", unit_price: "precio unitario", confirmed_at: "confirmación",
  supplier_id: "proveedor", unit_cost: "costo unitario", ordered_at: "envío", received_at: "recepción",
};
const IGNORED = new Set(["id", "org_id", "created_at"]);
const ROLE: Record<string, string> = { admin: "administrador", member: "miembro", viewer: "solo lectura" };
const REASON: Record<string, string> = { sale: "venta", sale_cancel: "venta cancelada", restock: "reposición", adjustment: "ajuste", purchase: "compra" };

type Diff = { old: Record<string, unknown> | null; new: Record<string, unknown> | null } | null;

/** Short label of the affected record: its name, SKU, order number, e-mail... */
export function subject(entity: string, diff: Diff): string {
  const row = diff?.new ?? diff?.old ?? {};
  if (entity === "orders") return row.number ? `#${row.number}` : "en borrador";
  if (entity === "stock_movements") return `${Number(row.delta) > 0 ? "+" : ""}${row.delta ?? ""} (${REASON[String(row.reason)] ?? row.reason ?? ""})`;
  if (entity === "purchase_orders") return row.number ? `OC-${String(row.number).padStart(4, "0")}` : "en borrador";
  if (entity === "order_items" || entity === "purchase_order_items") return `${row.qty ?? ""} u.`;
  if (entity === "memberships") return row.role ? `(${ROLE[String(row.role)] ?? row.role})` : "";
  return String(row.name ?? row.sku ?? row.email ?? "");
}

/** Names of the columns an update changed. */
export function changedFields(diff: Diff): string[] {
  if (!diff?.old || !diff.new) return [];
  const keys = new Set([...Object.keys(diff.old), ...Object.keys(diff.new)]);
  return [...keys]
    .filter((k) => !IGNORED.has(k) && JSON.stringify(diff.old![k]) !== JSON.stringify(diff.new![k]))
    .map((k) => FIELDS[k] ?? k);
}

export const entityLabel = (e: string) => (e in ENTITIES ? ENTITIES[e as Entity] : e);
export const actionVerb = (a: string) => (a in ACTIONS ? ACTIONS[a as Action] : a);
