import "server-only";
import { APP_NAME } from "@/lib/brand";

const FROM = process.env.EMAIL_FROM ?? `${APP_NAME} <onboarding@resend.dev>`;

/** Sends through Resend's REST API. Without RESEND_API_KEY (local dev) the email is logged instead. */
export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set");
    console.info(`[email:dev] to=${to} subject="${subject}"\n${html}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function sendInvitationEmail({ to, orgName, url }: { to: string; orgName: string; url: string }) {
  const org = escapeHtml(orgName);
  return sendEmail({
    to,
    subject: `Te invitaron a ${orgName}`,
    html: `<p>Te invitaron a unirte a <strong>${org}</strong>.</p><p><a href="${url}">Aceptar invitación</a></p><p>El enlace expira en 7 días. Si no esperabas este correo, ignóralo.</p>`,
  });
}
