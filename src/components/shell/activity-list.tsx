// Audit-log entries as a readable list: who did what to which record, which fields changed and when (in the organization's time zone).
import { actionVerb, changedFields, entityLabel, subject } from "@/lib/activity-text";
import { dateTime } from "@/lib/format";

type Row = { id: string; action: string; entity: string; diff: unknown; createdAt: Date | string; actor: string | null };

export function ActivityList({ rows, timezone }: { rows: Row[]; timezone: string }) {
  return (
    <ul className="divide-y divide-hairline-soft">
      {rows.map((r) => {
        const diff = r.diff as { old: Record<string, unknown> | null; new: Record<string, unknown> | null } | null;
        const fields = r.action === "update" ? changedFields(diff) : [];
        const what = subject(r.entity, diff);
        return (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <p className="min-w-0 text-ink">
              <span className="font-medium">{r.actor ?? "Sistema"}</span> {actionVerb(r.action)} {entityLabel(r.entity).toLowerCase()}
              {what && <span className="text-body"> {what}</span>}
              {fields.length > 0 && <span className="text-muted"> · cambió {fields.join(", ")}</span>}
            </p>
            <time dateTime={new Date(r.createdAt).toISOString()} className="shrink-0 text-[13px] text-muted">
              {dateTime(r.createdAt, timezone)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
