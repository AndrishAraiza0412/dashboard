import Link from "next/link";

export const metadata = { title: "Administración" };

// Chrome only: every page and Server Action under /admin checks platform-admin itself.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:rounded-md focus:bg-canvas focus:px-4 focus:py-2 focus:text-ink">
        Saltar al contenido
      </a>
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3 sm:px-6">
        <p className="font-medium text-ink">Administración de la plataforma</p>
        <Link href="/" className="text-[13px] text-body underline underline-offset-2">Volver a la app</Link>
      </div>
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
