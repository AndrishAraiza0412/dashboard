// Invitation page opened from the emailed link: a signed-in user accepts the invitation, otherwise they sign up with it.
import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { acceptInvite, signUpWithInvite } from "@/server/actions/auth";
import { getClaims } from "@/server/auth";

export const metadata = { title: "Invitación" };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <Suspense fallback={null}>
      <InviteContent params={params} />
    </Suspense>
  );
}

async function InviteContent({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  const claims = await getClaims();

  if (claims) {
    return (
      <>
        <h1 className="text-lg font-medium text-ink">Te invitaron a una organización</h1>
        <p className="mt-1 text-muted">Sesión iniciada como {claims.email}.</p>
        <div className="mt-4">
          <AuthForm action={acceptInvite} submit="Unirme" hidden={{ token }} fields={[]} />
        </div>
      </>
    );
  }
  return (
    <>
      <h1 className="text-lg font-medium text-ink">Crea tu cuenta</h1>
      <p className="mt-1 text-muted">Usa el correo al que llegó la invitación.</p>
      <div className="mt-4">
        <AuthForm
          action={signUpWithInvite}
          submit="Crear cuenta"
          hidden={{ token }}
          fields={[
            { name: "email", label: "Correo", type: "email", autoComplete: "email" },
            { name: "password", label: "Contraseña", type: "password", autoComplete: "new-password" },
          ]}
        />
      </div>
      <p className="mt-4 text-center text-[13px]">
        <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="text-primary-text underline underline-offset-2">
          Ya tengo cuenta
        </Link>
      </p>
    </>
  );
}
