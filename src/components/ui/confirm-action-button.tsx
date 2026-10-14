"use client";

import { useState } from "react";
import type { FormState } from "@/components/auth/auth-form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** ConfirmDialog around a Server Action that may answer with an error to show. */
export function ConfirmActionButton({
  action,
  ...dialog
}: { action: () => Promise<FormState> } & Omit<React.ComponentProps<typeof ConfirmDialog>, "onConfirm">) {
  const [error, setError] = useState<string>();
  return (
    <div>
      <ConfirmDialog {...dialog} onConfirm={async () => setError((await action()).error)} />
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-error">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      )}
    </div>
  );
}
