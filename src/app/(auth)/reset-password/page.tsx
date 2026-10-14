import { AuthForm } from "@/components/auth/auth-form";
import { resetPassword } from "@/server/actions/auth";

export const metadata = { title: "Nueva contraseña" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-medium text-ink">Crea tu contraseña nueva</h1>
      <div className="mt-4">
        <AuthForm
          action={resetPassword}
          submit="Guardar contraseña"
          fields={[
            { name: "password", label: "Contraseña nueva", type: "password", autoComplete: "new-password" },
            { name: "confirm", label: "Repite la contraseña", type: "password", autoComplete: "new-password" },
          ]}
        />
      </div>
    </>
  );
}
