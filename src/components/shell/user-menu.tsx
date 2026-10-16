import { Icon } from "@/components/ui/icons";
import { signOut } from "@/server/actions/auth";

export function UserMenu({ email }: { email?: string }) {
  return (
    <details className="relative">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-[13px] text-body transition-colors hover:bg-surface-card [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-surface-strong text-[12px] font-medium uppercase text-ink">
          {(email ?? "?")[0]}
        </span>
        <span className="max-w-[160px] truncate">{email ?? "Cuenta"}</span>
        <Icon name="chevronDown" className="size-4 text-muted" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-52 rounded-lg border border-hairline bg-canvas p-1 shadow-lg">
        <form action={signOut}>
          <button type="submit" className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-card">
            <Icon name="logout" className="size-4 text-muted" />
            Cerrar sesión
          </button>
        </form>
      </div>
    </details>
  );
}
