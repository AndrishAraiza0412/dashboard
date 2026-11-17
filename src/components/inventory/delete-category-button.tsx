"use client";

// Delete button with a confirmation dialog; shows the error returned by the server action (for example, when the category still has products).
import { useState } from "react";
import type { FormState } from "@/components/auth/auth-form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function DeleteCategoryButton({ name, action }: { name: string; action: () => Promise<FormState> }) {
  const [error, setError] = useState<string>();
  return (
    <div>
      <ConfirmDialog
        trigger="Eliminar"
        destructive
        title={`¿Eliminar "${name}"?`}
        description="Solo se puede eliminar si no tiene productos."
        confirmLabel="Eliminar"
        onConfirm={async () => setError((await action()).error)}
      />
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-error">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      )}
    </div>
  );
}
