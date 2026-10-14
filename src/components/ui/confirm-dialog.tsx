"use client";

import { useId, useRef } from "react";
import { Button } from "./button";

/** Native <dialog>: focus trap, Esc to close and backdrop come from the platform. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirmar",
  destructive,
  onConfirm,
}: {
  trigger: string;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <>
      <Button variant={destructive ? "danger" : "secondary"} onClick={() => ref.current?.showModal()}>
        {trigger}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={id}
        className="m-auto w-[min(92vw,420px)] rounded-lg border border-hairline bg-canvas p-6 text-body backdrop:bg-ink/40"
      >
        <h2 id={id} className="text-lg font-medium text-ink">
          {title}
        </h2>
        <p className="mt-2 text-muted">{description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            Cancelar
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={async () => {
              await onConfirm();
              ref.current?.close();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
