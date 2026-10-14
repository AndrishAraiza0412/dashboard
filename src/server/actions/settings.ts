"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { invitations, organizations } from "@/db/schema";
import type { FormState } from "@/components/auth/auth-form";
import { requireMembership, withUser } from "@/server/db/with-org";

const pgMessage = (e: unknown) => (e as { cause?: { message?: string } }).cause?.message ?? "";
const refresh = (slug: string) => revalidatePath(`/o/${slug}`, "layout");

// NumberFormat accepts any 3 letters, so check against the list of real currencies.
const validCurrency = (c: string) => Intl.supportedValuesOf("currency").includes(c);
const validZone = (z: string) => {
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

const orgInput = z.object({
  name: z.string().trim().min(1, "Campo obligatorio").max(80, "Demasiado largo"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).refine(validCurrency, "Moneda no válida (ej. MXN)"),
  timezone: z.string().trim().refine(validZone, "Zona horaria no válida (ej. America/Mexico_City)"),
});

export async function updateOrg(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireMembership(slug, "admin");
  const parsed = orgInput.safeParse({ name: fd.get("name"), currency: fd.get("currency"), timezone: fd.get("timezone") });
  if (!parsed.success) return { error: parsed.error.issues.at(-1)?.message ?? "Datos no válidos" };
  await withUser((tx) => tx.update(organizations).set(parsed.data).where(eq(organizations.id, ctx.orgId)));
  refresh(slug);
  return { message: "Cambios guardados." };
}

/** Membership functions are SECURITY DEFINER and keep at least one admin; their errors become messages. */
function memberError(e: unknown): FormState | null {
  const m = pgMessage(e);
  if (m.includes("at least one admin")) return { error: "La organización necesita al menos un administrador." };
  if (m.includes("demo")) return { error: "No puedes salir de la organización de demostración." };
  if (m.includes("not found") || m.includes("not a member")) return { error: "Esa persona ya no es miembro." };
  return null;
}

export async function changeRole(slug: string, userId: string, _: FormState, fd: FormData): Promise<FormState> {
  const ctx = await requireMembership(slug, "admin");
  const role = z.enum(["admin", "member", "viewer"]).safeParse(fd.get("role"));
  if (!role.success) return { error: "Rol no válido" };
  try {
    await withUser((tx) => tx.execute(sql`select public.change_member_role(${ctx.orgId}::uuid, ${userId}::uuid, ${role.data}::public.member_role)`));
  } catch (e) {
    const known = memberError(e);
    if (known) return known;
    throw e;
  }
  refresh(slug);
  return { message: "Rol actualizado." };
}

export async function removeMember(slug: string, userId: string): Promise<FormState> {
  const ctx = await requireMembership(slug, "admin");
  try {
    await withUser((tx) => tx.execute(sql`select public.remove_member(${ctx.orgId}::uuid, ${userId}::uuid)`));
  } catch (e) {
    const known = memberError(e);
    if (known) return known;
    throw e;
  }
  refresh(slug);
  return {};
}

export async function leaveOrg(slug: string): Promise<FormState> {
  const ctx = await requireMembership(slug);
  try {
    await withUser((tx) => tx.execute(sql`select public.leave_org(${ctx.orgId}::uuid)`));
  } catch (e) {
    const known = memberError(e);
    if (known) return known;
    throw e;
  }
  redirect("/");
}

export async function revokeInvitation(slug: string, id: string) {
  const ctx = await requireMembership(slug, "admin");
  await withUser((tx) => tx.delete(invitations).where(and(eq(invitations.id, id), eq(invitations.orgId, ctx.orgId))));
  refresh(slug);
}
