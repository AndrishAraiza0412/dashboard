"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { FormState } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * A form for a Server Action that returns { error | message }. Unlike `<form action>`, React does not
 * wipe the fields after a failed submit; they are cleared only on success when `resetOnSuccess` is set.
 */
export function ActionForm({
  action,
  submit,
  children,
  resetOnSuccess,
  variant = "primary",
  className,
  submitLabel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  submit: string;
  children?: React.ReactNode;
  resetOnSuccess?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
  /** Accessible name for the submit button when the visible text repeats on the page. */
  submitLabel?: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.message) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      className={cn("space-y-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => run(fd));
      }}
    >
      {children}
      {state.error && (
        <p role="alert" className="rounded-md bg-error-bg px-3 py-2 text-[13px] text-error">
          <span aria-hidden="true">✕ </span>
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="rounded-md bg-success-bg px-3 py-2 text-[13px] text-success">
          <span aria-hidden="true">✓ </span>
          {state.message}
        </p>
      )}
      <Button type="submit" variant={variant} disabled={pending} aria-label={submitLabel}>
        {pending ? "Un momento…" : submit}
      </Button>
    </form>
  );
}
