// Organization settings: organization data, members and roles, invitations, and leaving the organization.
import { Suspense } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Field, SelectField } from "@/components/ui/input";
import { CurrencySelect, TimezoneSelect } from "@/components/ui/option-selects";
import { PageHeader } from "@/components/ui/page-header";
import { dateTime } from "@/lib/format";
import { inviteMember } from "@/server/actions/invitations";
import { changeRole, leaveOrg, removeMember, revokeInvitation, updateOrg } from "@/server/actions/settings";
import { listMembers, listPendingInvitations } from "@/server/settings";
import { loadOrg } from "@/server/db/with-org";
import { PageSkeleton } from "@/components/ui/page-skeleton";

export const metadata = { title: "Ajustes" };

const ROLES = { admin: "Administrador", member: "Miembro", viewer: "Solo lectura" } as const;

export default function SettingsPage({ params }: PageProps<"/o/[orgSlug]/settings">) {
  return (
    <Suspense fallback={<PageSkeleton rows={4} />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: Pick<PageProps<"/o/[orgSlug]/settings">, "params">) {
  const { orgSlug } = await params;
  const {
    ctx,
    data: { members, pending },
  } = await loadOrg(orgSlug, "viewer", async (tx, ctx) => {
    const [members, pending] = await Promise.all([listMembers(tx, ctx.orgId), ctx.role === "admin" ? listPendingInvitations(tx, ctx.orgId) : Promise.resolve([])]);
    return { members, pending };
  });
  const isAdmin = ctx.role === "admin";

  return (
    <div className="fade-in">
      <PageHeader title="Ajustes" description={ctx.name} />
      <div className="space-y-12">
        {isAdmin && (
          <section aria-labelledby="org" className="max-w-xl">
            <h2 id="org" className="mb-4 text-lg font-medium text-ink">Organización</h2>
            <ActionForm action={updateOrg.bind(null, orgSlug)} submit="Guardar cambios">
              <Field id="name" name="name" label="Nombre" defaultValue={ctx.name} required maxLength={80} />
              <div className="grid gap-4 sm:grid-cols-2">
                <CurrencySelect id="currency" defaultValue={ctx.currency} />
                <TimezoneSelect id="timezone" defaultValue={ctx.timezone} />
              </div>
            </ActionForm>
          </section>
        )}

        <section aria-labelledby="members">
          <h2 id="members" className="mb-4 text-lg font-medium text-ink">Miembros</h2>
          <ul className="divide-y divide-hairline-soft rounded-lg border border-hairline">
            {members.map((m) => {
              const me = m.userId === ctx.userId;
              return (
                <li key={m.userId} className="flex flex-wrap items-end justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{m.fullName || m.email}{me && <span className="font-normal text-muted"> (tú)</span>}</p>
                    {m.fullName && <p className="truncate text-[13px] text-muted">{m.email}</p>}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {isAdmin ? (
                      <ActionForm action={changeRole.bind(null, orgSlug, m.userId)} submit="Guardar" submitLabel={`Guardar rol de ${m.fullName || m.email}`} variant="secondary" className="flex flex-wrap items-end gap-2 space-y-0">
                        <SelectField id={`role-${m.userId}`} name="role" label="Rol" defaultValue={m.role}>
                          {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </SelectField>
                      </ActionForm>
                    ) : (
                      <Badge>{ROLES[m.role]}</Badge>
                    )}
                    {me ? (
                      <ConfirmActionButton action={leaveOrg.bind(null, orgSlug)} trigger="Salir" destructive title="¿Salir de la organización?" description="Perderás el acceso. Un administrador tendrá que invitarte de nuevo." confirmLabel="Salir" />
                    ) : (
                      isAdmin && <ConfirmActionButton action={removeMember.bind(null, orgSlug, m.userId)} trigger="Quitar" destructive title={`¿Quitar a ${m.fullName || m.email}?`} description="Dejará de tener acceso a la organización." confirmLabel="Quitar" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {isAdmin && (
          <section aria-labelledby="invite" className="max-w-xl">
            <h2 id="invite" className="mb-4 text-lg font-medium text-ink">Invitar a alguien</h2>
            <ActionForm action={inviteMember.bind(null, orgSlug)} submit="Enviar invitación" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                <Field id="invite-email" name="email" label="Correo" type="email" autoComplete="off" spellCheck={false} required />
                <SelectField id="invite-role" name="role" label="Rol" defaultValue="member">
                  {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </SelectField>
              </div>
            </ActionForm>
            {pending.length > 0 && (
              <>
                <h3 className="mb-2 mt-8 text-[13px] font-medium text-muted">Invitaciones pendientes</h3>
                <ul className="divide-y divide-hairline-soft rounded-lg border border-hairline">
                  {pending.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{i.email}</span>
                        <span className="text-[13px] text-muted">{ROLES[i.role]} · expira {dateTime(i.expiresAt, ctx.timezone)}</span>
                      </span>
                      <form action={revokeInvitation.bind(null, orgSlug, i.id)}>
                        <Button type="submit" variant="ghost" aria-label={`Revocar invitación de ${i.email}`}>Revocar</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
