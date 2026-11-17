"use client";

// Generic auth form: renders its fields, submits a server action through useActionState and shows the error or message it returns.
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";

export type FormState = { error?: string; message?: string };
type FieldDef = { name: string; label: string; type?: string; autoComplete?: string; defaultValue?: string };

export function AuthForm({
  action,
  fields,
  submit,
  hidden,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: FieldDef[];
  submit: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => (
        <Field key={f.name} id={f.name} name={f.name} label={f.label} type={f.type ?? "text"} autoComplete={f.autoComplete} defaultValue={f.defaultValue} required />
      ))}
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
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Un momento…" : submit}
      </Button>
    </form>
  );
}
