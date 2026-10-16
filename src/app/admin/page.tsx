import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Field } from "@/components/ui/input";
import { CurrencySelect, TimezoneSelect } from "@/components/ui/option-selects";
import { PageHeader } from "@/components/ui/page-header";
import { MODULES } from "@/lib/modules";
import { createOrg, setModules, setSuspended } from "@/server/actions/admin";
import { loadAdminOrgs } from "@/server/admin";
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function AdminPage() {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Content />
    </Suspense>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[var(--primary-strong)]" />
      {label}
    </label>
  );
}

async function Content() {
  const orgs = await loadAdminOrgs();
  return (
    <div className="fade-in">
      <PageHeader title="Organizaciones" description={`${orgs.length} en la plataforma`} />

      <section aria-labelledby="new-org" className="mb-10 max-w-xl rounded-xl border border-hairline bg-surface-card p-6">
        <h2 id="new-org" className="mb-4 text-lg font-medium text-ink">Nueva organización</h2>
        <ActionForm action={createOrg} submit="Crear e invitar" resetOnSuccess>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="org-name" name="name" label="Nombre" required maxLength={80} />
            <Field id="org-slug" name="slug" label="Identificador (URL)" required maxLength={40} />
            <CurrencySelect id="org-currency" defaultValue="MXN" />
            <TimezoneSelect id="org-timezone" defaultValue="America/Mexico_City" />
          </div>
          <Field id="org-email" name="email" label="Correo de su primer administrador" type="email" autoComplete="off" spellCheck={false} required />
        </ActionForm>
      </section>

      <ul className="stagger space-y-4">
        {orgs.map((o) => (
          <li key={o.id} className="rounded-xl border border-hairline bg-canvas p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-shadow hover:shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{o.name}</p>
                <p className="text-[13px] text-muted">/{o.slug} · {o.currency} · {o.timezone}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {o.isDemo && <Badge>Demo</Badge>}
                {o.suspended && <Badge tone="error">Suspendida</Badge>}
                <Link href={`/o/${o.slug}`} className="text-[13px] text-body underline underline-offset-2">Abrir</Link>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <ActionForm action={setModules.bind(null, o.id)} submit="Guardar módulos" variant="secondary" className="flex flex-wrap items-center gap-4 space-y-0">
                {MODULES.map((m) => (
                  <Check key={m.id} name={m.id} label={m.label} defaultChecked={o.modules.includes(m.id)} />
                ))}
              </ActionForm>
              {o.suspended ? (
                <ConfirmActionButton action={setSuspended.bind(null, o.id, false)} trigger="Reactivar" title={`¿Reactivar ${o.name}?`} description="Sus miembros recuperarán el acceso." confirmLabel="Reactivar" />
              ) : (
                <ConfirmActionButton action={setSuspended.bind(null, o.id, true)} trigger="Suspender" destructive title={`¿Suspender ${o.name}?`} description="Sus miembros dejarán de ver la organización. Los datos se conservan." confirmLabel="Suspender" />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
