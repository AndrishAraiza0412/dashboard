"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { customers, orderItems, orders, products } from "@/db/schema";
import type { FormState } from "@/components/auth/auth-form";
import { requireMembership, requireModule, withUser } from "@/server/db/with-org";

const pgCode = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code;
const pgMessage = (e: unknown) => (e as { cause?: { message?: string } }).cause?.message ?? "";

/** Every write: member+ of this org, sales module on. The org id comes from here, never from the form. */
async function ctxFor(slug: string) {
  const ctx = await requireMembership(slug, "member");
  await requireModule(ctx, "sales");
  return ctx;
}
const refresh = (slug: string) => revalidatePath(`/o/${slug}/sales`, "layout");

const optional = (max: number) => z.string().trim().max(max, "Demasiado largo").transform((v) => v || null);
const price = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Precio no válido (ej. 25.50)");
const qty = z.coerce.number({ error: "Cantidad no válida" }).int("Debe ser entero").min(1, "Mínimo 1").max(1_000_000, "Demasiado grande");

// ---- customers -----------------------------------------------------------------------------

const customerInput = z.object({
  name: z.string().trim().min(1, "Campo obligatorio").max(120, "Demasiado largo"),
  email: optional(160).pipe(z.email("Correo no válido").nullable()),
  phone: optional(40),
});
const parseCustomer = (fd: FormData) =>
  customerInput.safeParse({ name: fd.get("name"), email: fd.get("email") ?? "", phone: fd.get("phone") ?? "" });

export async function createCustomer(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = parseCustomer(fd);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser((tx) => tx.insert(customers).values({ orgId: ctx.orgId, ...parsed.data }));
  refresh(slug);
  return { message: "Cliente creado." };
}

export async function updateCustomer(slug: string, id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = parseCustomer(fd);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser((tx) => tx.update(customers).set(parsed.data).where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId))));
  refresh(slug);
  return { message: "Guardado." };
}

/** Customers are never deleted (orders reference them); they are switched off. */
export async function setCustomerActive(slug: string, id: string, active: boolean) {
  const ctx = await ctxFor(slug);
  await withUser((tx) => tx.update(customers).set({ active }).where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId))));
  refresh(slug);
}

// ---- draft orders ----------------------------------------------------------------------------

export async function createOrder(slug: string) {
  const ctx = await ctxFor(slug);
  const [{ id }] = await withUser((tx) => tx.insert(orders).values({ orgId: ctx.orgId }).returning({ id: orders.id }));
  refresh(slug);
  redirect(`/o/${slug}/sales/${id}`);
}

export async function updateOrderHeader(slug: string, id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = z
    .object({ customerId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()), notes: optional(500) })
    .safeParse({ customerId: fd.get("customerId") ?? "", notes: fd.get("notes") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await withUser((tx) => tx.update(orders).set(parsed.data).where(and(eq(orders.id, id), eq(orders.orgId, ctx.orgId))));
  } catch (e) {
    if (pgCode(e) === "23503") return { error: "El cliente ya no existe." };
    throw e;
  }
  refresh(slug);
  return { message: "Guardado." };
}

export async function addLine(slug: string, orderId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = z.object({ productId: z.uuid("Elige un producto"), qty }).safeParse({ productId: fd.get("productId"), qty: fd.get("qty") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await withUser(async (tx) => {
      const [p] = await tx.select({ price: products.price }).from(products).where(and(eq(products.id, parsed.data.productId), eq(products.orgId, ctx.orgId), eq(products.active, true)));
      if (!p) throw new Error("product not found");
      // RLS only lets this through while the order is a draft of this org.
      await tx.insert(orderItems).values({ orgId: ctx.orgId, orderId, productId: parsed.data.productId, qty: parsed.data.qty, unitPrice: p.price });
    });
  } catch (e) {
    if (pgCode(e) === "23505") return { error: "Ese producto ya está en el pedido; edita su cantidad." };
    if (pgCode(e) === "42501" || pgCode(e) === "23503") return { error: "No se puede modificar este pedido." };
    throw e;
  }
  refresh(slug);
  return { message: "Producto añadido." };
}

export async function updateLine(slug: string, lineId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = z.object({ qty, unitPrice: price }).safeParse({ qty: fd.get("qty"), unitPrice: fd.get("unitPrice") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await withUser((tx) => tx.update(orderItems).set(parsed.data).where(and(eq(orderItems.id, lineId), eq(orderItems.orgId, ctx.orgId))));
  refresh(slug);
  return { message: "Guardado." };
}

export async function removeLine(slug: string, lineId: string) {
  const ctx = await ctxFor(slug);
  await withUser((tx) => tx.delete(orderItems).where(and(eq(orderItems.id, lineId), eq(orderItems.orgId, ctx.orgId))));
  refresh(slug);
}

// ---- status changes (security definer functions do the work) ---------------------------------------

async function transition(slug: string, orderId: string, fn: "confirm_order" | "fulfill_order" | "cancel_order"): Promise<FormState> {
  const ctx = await ctxFor(slug);
  try {
    await withUser(async (tx) => {
      const [o] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, ctx.orgId)));
      if (!o) throw new Error("order not found");
      await tx.execute(sql`select public.${sql.raw(fn)}(${orderId}::uuid)`);
    });
  } catch (e) {
    const m = pgMessage(e);
    const stock = /insufficient stock for (.*)/.exec(m);
    if (stock) return { error: `Stock insuficiente para ${stock[1]}.` };
    if (m.includes("no items")) return { error: "Añade al menos un producto." };
    if (pgCode(e) === "P0001") return { error: "El pedido ya cambió de estado. Recarga la página." };
    throw e;
  }
  refresh(slug);
  return { message: "Listo." };
}

// Bound with (slug, id); extra form arguments from useActionState are simply ignored.
export async function confirmOrder(slug: string, id: string) {
  return transition(slug, id, "confirm_order");
}
export async function fulfillOrder(slug: string, id: string) {
  return transition(slug, id, "fulfill_order");
}
export async function cancelOrder(slug: string, id: string) {
  return transition(slug, id, "cancel_order");
}
