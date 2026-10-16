"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { products, purchaseOrderItems, purchaseOrders, suppliers } from "@/db/schema";
import type { FormState } from "@/components/auth/auth-form";
import { requireMembership, requireModule, withUser } from "@/server/db/with-org";
import { listRestockSuggestions } from "@/server/purchases";

const pgCode = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code;
const pgMessage = (e: unknown) => (e as { cause?: { message?: string } }).cause?.message ?? "";

/** Every write: member+ of this org, inventory module on (purchases feed the stock). The org id comes from here, never from the form. */
async function ctxFor(slug: string) {
  const ctx = await requireMembership(slug, "member");
  await requireModule(ctx, "purchases");
  return ctx;
}
const refresh = (slug: string) => {
  revalidatePath(`/o/${slug}/purchases`, "layout");
  revalidatePath(`/o/${slug}/inventory`, "layout");
  revalidatePath(`/o/${slug}`);
};

const optional = (max: number) => z.string().trim().max(max, "Demasiado largo").transform((v) => v || null);
const cost = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Costo no válido (ej. 25.50)");
const qty = z.coerce.number({ error: "Cantidad no válida" }).int("Debe ser entero").min(1, "Mínimo 1").max(1_000_000, "Demasiado grande");

// ---- suppliers ---------------------------------------------------------------------------

const supplierInput = z.object({
  name: z.string().trim().min(1, "Campo obligatorio").max(120, "Demasiado largo"),
  email: optional(160).pipe(z.email("Correo no válido").nullable()),
  phone: optional(40),
});
const parseSupplier = (fd: FormData) => supplierInput.safeParse({ name: fd.get("name"), email: fd.get("email") ?? "", phone: fd.get("phone") ?? "" });

export async function createSupplier(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = parseSupplier(fd);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser((tx) => tx.insert(suppliers).values({ orgId: ctx.orgId, ...parsed.data }));
  refresh(slug);
  return { message: "Proveedor creado." };
}

export async function updateSupplier(slug: string, id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = parseSupplier(fd);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser((tx) => tx.update(suppliers).set(parsed.data).where(and(eq(suppliers.id, id), eq(suppliers.orgId, ctx.orgId))));
  refresh(slug);
  return { message: "Guardado." };
}

/** Suppliers are never deleted (purchase orders reference them); they are switched off. */
export async function setSupplierActive(slug: string, id: string, active: boolean) {
  const ctx = await ctxFor(slug);
  await withUser((tx) => tx.update(suppliers).set({ active }).where(and(eq(suppliers.id, id), eq(suppliers.orgId, ctx.orgId))));
  refresh(slug);
}

// ---- draft purchase orders -----------------------------------------------------------------

export async function createPurchaseOrder(slug: string) {
  const ctx = await ctxFor(slug);
  const [{ id }] = await withUser((tx) => tx.insert(purchaseOrders).values({ orgId: ctx.orgId }).returning({ id: purchaseOrders.id }));
  refresh(slug);
  redirect(`/o/${slug}/purchases/${id}`);
}

/** A draft pre-filled with every low-stock product (quantity up to twice its reorder level, at its current cost). */
export async function createRestockOrder(slug: string) {
  const ctx = await ctxFor(slug);
  const id = await withUser(async (tx) => {
    const lines = await listRestockSuggestions(tx, ctx.orgId);
    const [{ id }] = await tx.insert(purchaseOrders).values({ orgId: ctx.orgId, notes: "Reposición de stock bajo" }).returning({ id: purchaseOrders.id });
    if (lines.length) await tx.insert(purchaseOrderItems).values(lines.map((l) => ({ orgId: ctx.orgId, purchaseOrderId: id, productId: l.id, qty: l.qty, unitCost: l.cost })));
    return id;
  });
  refresh(slug);
  redirect(`/o/${slug}/purchases/${id}`);
}

export async function updatePurchaseHeader(slug: string, id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = z
    .object({ supplierId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()), notes: optional(500) })
    .safeParse({ supplierId: fd.get("supplierId") ?? "", notes: fd.get("notes") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await withUser((tx) => tx.update(purchaseOrders).set(parsed.data).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.orgId, ctx.orgId))));
  } catch (e) {
    if (pgCode(e) === "23503") return { error: "El proveedor ya no existe." };
    throw e;
  }
  refresh(slug);
  return { message: "Guardado." };
}

export async function addPurchaseLine(slug: string, poId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = z.object({ productId: z.uuid("Elige un producto"), qty }).safeParse({ productId: fd.get("productId"), qty: fd.get("qty") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await withUser(async (tx) => {
      const [p] = await tx.select({ cost: products.cost }).from(products).where(and(eq(products.id, parsed.data.productId), eq(products.orgId, ctx.orgId), eq(products.active, true)));
      if (!p) throw new Error("product not found");
      // RLS only lets this through while the purchase order is a draft of this org.
      await tx.insert(purchaseOrderItems).values({ orgId: ctx.orgId, purchaseOrderId: poId, productId: parsed.data.productId, qty: parsed.data.qty, unitCost: p.cost });
    });
  } catch (e) {
    if (pgCode(e) === "23505") return { error: "Ese producto ya está en la orden; edita su cantidad." };
    if (pgCode(e) === "42501" || pgCode(e) === "23503") return { error: "No se puede modificar esta orden." };
    throw e;
  }
  refresh(slug);
  return { message: "Producto añadido." };
}

export async function updatePurchaseLine(slug: string, lineId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = z.object({ qty, unitCost: cost }).safeParse({ qty: fd.get("qty"), unitCost: fd.get("unitCost") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser((tx) => tx.update(purchaseOrderItems).set(parsed.data).where(and(eq(purchaseOrderItems.id, lineId), eq(purchaseOrderItems.orgId, ctx.orgId))));
  refresh(slug);
  return { message: "Guardado." };
}

export async function removePurchaseLine(slug: string, lineId: string) {
  const ctx = await ctxFor(slug);
  await withUser((tx) => tx.delete(purchaseOrderItems).where(and(eq(purchaseOrderItems.id, lineId), eq(purchaseOrderItems.orgId, ctx.orgId))));
  refresh(slug);
}

// ---- status changes (security definer functions do the work) ---------------------------------------

async function transition(slug: string, poId: string, fn: "place_purchase_order" | "receive_purchase_order" | "cancel_purchase_order"): Promise<FormState> {
  const ctx = await ctxFor(slug);
  try {
    await withUser(async (tx) => {
      const [po] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, ctx.orgId)));
      if (!po) throw new Error("purchase order not found");
      await tx.execute(sql`select public.${sql.raw(fn)}(${poId}::uuid)`);
    });
  } catch (e) {
    const m = pgMessage(e);
    if (m.includes("no supplier")) return { error: "Elige un proveedor y guarda antes de enviar la orden." };
    if (m.includes("no items")) return { error: "Añade al menos un producto." };
    if (pgCode(e) === "P0001") return { error: "La orden ya cambió de estado. Recarga la página." };
    throw e;
  }
  refresh(slug);
  return { message: "Listo." };
}

// Bound with (slug, id); extra form arguments from useActionState are simply ignored.
export async function placePurchaseOrder(slug: string, id: string) {
  return transition(slug, id, "place_purchase_order");
}
export async function receivePurchaseOrder(slug: string, id: string) {
  return transition(slug, id, "receive_purchase_order");
}
export async function cancelPurchaseOrder(slug: string, id: string) {
  return transition(slug, id, "cancel_purchase_order");
}
