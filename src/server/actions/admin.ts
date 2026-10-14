"use server";

import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/auth/auth-form";
import { requirePlatformAdmin } from "@/server/admin";
import { withUser } from "@/server/db/with-org";
import { sendInvitationEmail } from "@/server/email";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const pgCode = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code;
const refresh = () => revalidatePath("/admin");

const valid = (f: () => unknown) => {
  try {
    f();
    return true;
  } catch {
    return false;
  }
};

const createInput = z.object({
  name: z.string().trim().min(1, "Campo obligatorio").max(80, "Demasiado largo"),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "El identificador usa 3–40 letras minúsculas, números o guiones"),
  currency: z.string().trim().toUpperCase().refine((c) => Intl.supportedValuesOf("currency").includes(c), "Moneda no válida"),
  timezone: z.string().trim().refine((t) => valid(() => new Intl.DateTimeFormat("es-MX", { timeZone: t })), "Zona horaria no válida"),
  email: z.email("Correo no válido"),
});

/** Creates the organization and its first admin invitation in one database call, then emails the link. */
export async function createOrg(_: FormState, fd: FormData): Promise<FormState> {
  await requirePlatformAdmin();
  const parsed = createInput.safeParse(Object.fromEntries(["name", "slug", "currency", "timezone", "email"].map((k) => [k, fd.get(k)])));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, slug, currency, timezone, email } = parsed.data;
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  try {
    await withUser((tx) => tx.execute(sql`select public.admin_create_org(${name}, ${slug}, ${currency}, ${timezone}, ${email}, ${tokenHash})`));
  } catch (e) {
    if (pgCode(e) === "23505") return { error: "Ya existe una organización con ese identificador." };
    throw e;
  }
  await sendInvitationEmail({ to: email, orgName: name, url: `${SITE_URL}/invite/${token}` });
  refresh();
  return { message: `Organización creada. Invitación enviada a ${email}.` };
}

export async function setModules(orgId: string, _: FormState, fd: FormData): Promise<FormState> {
  await requirePlatformAdmin();
  const id = z.uuid().safeParse(orgId);
  if (!id.success) return { error: "Organización no válida" };
  const sales = fd.get("sales") === "on";
  const inventory = fd.get("inventory") === "on";
  if (sales && !inventory) return { error: "Ventas necesita el módulo de Inventario." };
  const modules = [inventory && "inventory", sales && "sales"].filter(Boolean) as string[];
  const arr = sql`array[${sql.join(modules.map((m) => sql`${m}`), sql`, `)}]::text[]`;
  await withUser((tx) => tx.execute(sql`select public.admin_set_modules(${id.data}::uuid, ${arr})`));
  refresh();
  return { message: "Módulos actualizados." };
}

export async function setSuspended(orgId: string, suspend: boolean): Promise<FormState> {
  await requirePlatformAdmin();
  const id = z.uuid().parse(orgId);
  await withUser((tx) => tx.execute(sql`select public.admin_suspend_org(${id}::uuid, ${suspend})`));
  refresh();
  return {};
}
