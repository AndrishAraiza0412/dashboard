"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { categories, products } from "@/db/schema";
import type { FormState } from "@/components/auth/auth-form";
import { requireMembership, requireModule, withUser } from "@/server/db/with-org";

const pgCode = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code;
const pgMessage = (e: unknown) => (e as { cause?: { message?: string } }).cause?.message ?? "";

/** Every write: member+ of this org, inventory module on. The org id comes from here, never from the form. */
async function ctxFor(slug: string) {
  const ctx = await requireMembership(slug, "member");
  await requireModule(ctx, "inventory");
  return ctx;
}

const text = (max: number) => z.string().trim().min(1, "Campo obligatorio").max(max, "Demasiado largo");
const money = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Importe no válido (ej. 25.50)");
const whole = z.coerce.number({ error: "Número no válido" }).int("Debe ser entero").min(0, "No puede ser negativo").max(1_000_000, "Demasiado grande");

// ---- categories ----------------------------------------------------------------------------

const categoryName = z.object({ name: text(60) });

export async function createCategory(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = categoryName.safeParse({ name: fd.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await withUser((tx) => tx.insert(categories).values({ orgId: ctx.orgId, name: parsed.data.name }));
  } catch (e) {
    if (pgCode(e) === "23505") return { error: "Ya existe una categoría con ese nombre." };
    throw e;
  }
  revalidatePath(`/o/${slug}/inventory`, "layout");
  return { message: "Categoría creada." };
}

export async function renameCategory(slug: string, id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = categoryName.safeParse({ name: fd.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await withUser((tx) =>
      tx.update(categories).set({ name: parsed.data.name }).where(and(eq(categories.id, id), eq(categories.orgId, ctx.orgId))),
    );
  } catch (e) {
    if (pgCode(e) === "23505") return { error: "Ya existe una categoría con ese nombre." };
    throw e;
  }
  revalidatePath(`/o/${slug}/inventory`, "layout");
  return { message: "Guardado." };
}

export async function deleteCategory(slug: string, id: string): Promise<FormState> {
  const ctx = await ctxFor(slug);
  try {
    await withUser((tx) => tx.delete(categories).where(and(eq(categories.id, id), eq(categories.orgId, ctx.orgId))));
  } catch (e) {
    if (pgCode(e) === "23503") return { error: "Hay productos en esta categoría. Cámbialos de categoría primero." };
    throw e;
  }
  revalidatePath(`/o/${slug}/inventory`, "layout");
  return {};
}

// ---- products ------------------------------------------------------------------------------

const productInput = z.object({
  sku: text(40),
  name: text(120),
  categoryId: z.string().transform((v) => v || null).pipe(z.uuid().nullable()),
  price: money,
  cost: money,
  reorderLevel: whole,
});

const parseProduct = (fd: FormData) =>
  productInput.safeParse({
    sku: fd.get("sku"),
    name: fd.get("name"),
    categoryId: fd.get("categoryId") ?? "",
    price: fd.get("price"),
    cost: fd.get("cost"),
    reorderLevel: fd.get("reorderLevel"),
  });

const productError = (e: unknown): FormState | null => {
  if (pgCode(e) === "23505") return { error: "Ya existe un producto con ese SKU." };
  if (pgCode(e) === "23503") return { error: "La categoría ya no existe." };
  return null;
};

export async function createProduct(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = parseProduct(fd);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let id: string;
  try {
    [{ id }] = await withUser((tx) =>
      tx.insert(products).values({ orgId: ctx.orgId, ...parsed.data }).returning({ id: products.id }),
    );
  } catch (e) {
    const known = productError(e);
    if (known) return known;
    throw e;
  }
  revalidatePath(`/o/${slug}/inventory`, "layout");
  redirect(`/o/${slug}/inventory/${id}`);
}

export async function updateProduct(slug: string, id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = parseProduct(fd);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await withUser((tx) =>
      tx.update(products).set(parsed.data).where(and(eq(products.id, id), eq(products.orgId, ctx.orgId))),
    );
  } catch (e) {
    const known = productError(e);
    if (known) return known;
    throw e;
  }
  revalidatePath(`/o/${slug}/inventory`, "layout");
  return { message: "Cambios guardados." };
}

/** Products are never deleted (orders and movements reference them); they are switched off. */
export async function setProductActive(slug: string, id: string, active: boolean) {
  const ctx = await ctxFor(slug);
  await withUser((tx) =>
    tx.update(products).set({ active }).where(and(eq(products.id, id), eq(products.orgId, ctx.orgId))),
  );
  revalidatePath(`/o/${slug}/inventory`, "layout");
}

// ---- stock ---------------------------------------------------------------------------------

const adjustInput = z.object({
  delta: z.coerce.number({ error: "Cantidad no válida" }).int("Debe ser entero").refine((n) => n !== 0, "La cantidad no puede ser 0").refine((n) => Math.abs(n) <= 1_000_000, "Demasiado grande"),
  reason: z.enum(["restock", "adjustment"]),
  note: z.string().trim().max(200, "Nota demasiado larga"),
});

export async function adjustStock(slug: string, id: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await ctxFor(slug);
  const parsed = adjustInput.safeParse({ delta: fd.get("delta"), reason: fd.get("reason"), note: fd.get("note") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { delta, reason, note } = parsed.data;
  try {
    await withUser(async (tx) => {
      // The id comes from the client: confirm it is a product of this org before calling the definer function.
      const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.id, id), eq(products.orgId, ctx.orgId)));
      if (!p) throw new Error("product not found");
      await tx.execute(sql`select public.adjust_stock(${id}::uuid, ${delta}::integer, ${reason}::public.movement_reason, ${note || null}::text)`);
    });
  } catch (e) {
    if (pgMessage(e).includes("negative")) return { error: "El stock no puede quedar en negativo." };
    throw e;
  }
  revalidatePath(`/o/${slug}/inventory`, "layout");
  return { message: "Stock actualizado." };
}
