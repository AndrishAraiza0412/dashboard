"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invitations } from "@/db/schema";
import { sendInvitationEmail } from "@/server/email";
import { requireMembership, withUser } from "@/server/db/with-org";
import type { FormState } from "@/components/auth/auth-form";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const input = z.object({ email: z.email("Escribe un correo válido"), role: z.enum(["admin", "member", "viewer"]) });
const pgCode = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code;

/** Bind the org slug from the page: `inviteMember.bind(null, orgSlug)`. */
export async function inviteMember(orgSlug: string, _: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMembership(orgSlug, "admin");
  const parsed = input.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos no válidos" };

  // The raw token only ever exists in the email; the database keeps its SHA-256.
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  try {
    await withUser((tx) =>
      tx.insert(invitations).values({ orgId: ctx.orgId, email: parsed.data.email.toLowerCase(), role: parsed.data.role, tokenHash }),
    );
  } catch (e) {
    if (pgCode(e) === "23505") return { error: "Ya hay una invitación pendiente para ese correo." };
    throw e;
  }
  revalidatePath(`/o/${orgSlug}/settings`);
  await sendInvitationEmail({ to: parsed.data.email, orgName: ctx.name, url: `${SITE_URL}/invite/${token}` });
  return { message: `Invitación enviada a ${parsed.data.email}.` };
}
