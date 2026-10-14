import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { login } from "@/server/actions/auth";
import { safeNext } from "@/server/auth";

export const metadata = { title: "Iniciar sesión" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={null}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null);
  const failedConfirm = sp.error === "confirm";
  // Public demo account (read-only viewer of the seeded Demo org); shown only when configured.
  const demoEmail = process.env.NEXT_PUBLIC_DEMO_EMAIL;
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
  return (
    <>
      <h1 className="text-lg font-medium text-ink">Iniciar sesión</h1>
      {failedConfirm && (
        <p role="alert" className="mt-3 rounded-md bg-error-bg px-3 py-2 text-[13px] text-error">
          <span aria-hidden="true">✕ </span>El enlace no es válido o ya expiró. Pide uno nuevo.
        </p>
      )}
      <div className="mt-4">
        <AuthForm
          action={login}
          submit="Entrar"
          hidden={{ next }}
          fields={[
            { name: "email", label: "Correo", type: "email", autoComplete: "email" },
            { name: "password", label: "Contraseña", type: "password", autoComplete: "current-password" },
          ]}
        />
      </div>
      {demoEmail && demoPassword && (
        <aside aria-label="Cuenta de demostración" className="mt-6 rounded-md bg-surface-card px-3 py-3 text-[13px] text-body">
          <p className="font-medium text-ink">Prueba la demo (solo lectura)</p>
          <p className="mt-1">Correo: <code className="font-mono text-ink">{demoEmail}</code></p>
          <p>Contraseña: <code className="font-mono text-ink">{demoPassword}</code></p>
        </aside>
      )}
      <p className="mt-4 text-center text-[13px]">
        <Link href="/forgot-password" className="text-primary-text underline underline-offset-2">
          ¿Olvidaste tu contraseña?
        </Link>
      </p>
    </>
  );
}
