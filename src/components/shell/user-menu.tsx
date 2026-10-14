import { signOut } from "@/server/actions/auth";

export function UserMenu({ email }: { email?: string }) {
  return (
    <details className="relative">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-[13px] text-body hover:bg-surface-card [&::-webkit-details-marker]:hidden">
        <span className="max-w-[160px] truncate">{email ?? "Cuenta"}</span>
        <span aria-hidden="true">▾</span>
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-hairline bg-canvas p-1 shadow-sm">
        <form action={signOut}>
          <button type="submit" className="w-full rounded-md px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-card">
            Cerrar sesión
          </button>
        </form>
      </div>
    </details>
  );
}
