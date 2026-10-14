import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Claims } from "@/server/db/rls";

/** Verified JWT claims (never getSession(), whose cookie contents are not verified). */
export const getClaims = cache(async (): Promise<Claims | null> => {
  // Verifying the JWT reads the clock; opt into request-time rendering before that happens.
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims as unknown as Claims;
});

export async function requireClaims(): Promise<Claims> {
  const claims = await getClaims();
  if (!claims) redirect("/login");
  return claims;
}

/** Only same-site relative paths, to avoid open redirects through ?next=. */
export function safeNext(next: FormDataEntryValue | string | null | undefined, fallback = "/"): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
