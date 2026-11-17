// Forgot-password page: asks for an email and sends a reset link.
import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";
import { forgotPassword } from "@/server/actions/auth";

export const metadata = { title: "Recuperar contraseña" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-medium text-ink">Recuperar contraseña</h1>
      <p className="mt-1 text-muted">Te enviaremos un enlace para crear una contraseña nueva.</p>
      <div className="mt-4">
        <AuthForm action={forgotPassword} submit="Enviar enlace" fields={[{ name: "email", label: "Correo", type: "email", autoComplete: "email" }]} />
      </div>
      <p className="mt-4 text-center text-[13px]">
        <Link href="/login" className="text-primary-text underline underline-offset-2">
          Volver a iniciar sesión
        </Link>
      </p>
    </>
  );
}
