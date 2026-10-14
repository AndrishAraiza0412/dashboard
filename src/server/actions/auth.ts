"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { organizations } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/server/auth";
import { withUser } from "@/server/db/with-org";
import type { FormState } from "@/components/auth/auth-form";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const email = z.email("Escribe un correo válido");
const password = z.string().min(8, "La contraseña debe tener al menos 8 caracteres");
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Datos no válidos";

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: z.string().min(1, "Escribe tu contraseña") }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for every failure so the form cannot be used to discover which emails exist.
  if (error) return { error: "Correo o contraseña incorrectos" };
  redirect(safeNext(formData.get("next")));
}

export async function forgotPassword(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = email.safeParse(formData.get("email"));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${SITE_URL}/auth/confirm?next=${encodeURIComponent("/reset-password")}`,
  });
  return { message: "Si el correo existe, te enviamos un enlace para crear una contraseña nueva." };
}

export async function resetPassword(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Las contraseñas no coinciden" })
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "No pudimos cambiar la contraseña. Pide un enlace nuevo." };
  redirect("/");
}

export async function signUpWithInvite(_: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const parsed = z.object({ email, password }).safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: firstError(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${SITE_URL}/auth/confirm?next=${encodeURIComponent(`/invite/${token}`)}` },
  });
  if (error) return { error: "No pudimos crear la cuenta. Revisa los datos e inténtalo de nuevo." };
  return { message: "Revisa tu correo y confirma tu cuenta para unirte a la organización." };
}

const pgMessage = (e: unknown) => String((e as { cause?: Error }).cause?.message ?? (e as Error).message);

export async function acceptInvite(_: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  let slug: string;
  try {
    slug = await withUser(async (tx) => {
      const [{ org }] = await tx.execute<{ org: string }>(sql`select public.accept_invitation(${token}) as org`);
      const [row] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, org));
      return row.slug;
    });
  } catch (e) {
    const msg = pgMessage(e);
    if (msg.includes("invalid or expired")) return { error: "La invitación no es válida, ya se usó o expiró. Pide una nueva." };
    if (msg.includes("email not confirmed")) return { error: "Confirma tu correo antes de aceptar la invitación." };
    return { error: "No pudimos aceptar la invitación." };
  }
  redirect(`/o/${slug}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
