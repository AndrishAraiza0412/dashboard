import Link from "next/link";
import { ThemePicker } from "@/components/shell/theme-picker";
import { BrandMark, Icon } from "@/components/ui/icons";

export const metadata = { title: "Administración" };

// Chrome only: every page and Server Action under /admin checks platform-admin itself.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-20 focus:rounded-md focus:bg-canvas focus:px-4 focus:py-2 focus:text-ink">
        Saltar al contenido
      </a>
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-hairline bg-canvas/80 px-4 py-3 backdrop-blur-md sm:px-6">
        <p className="flex min-w-0 items-center gap-2.5 font-medium text-ink"><BrandMark /><span className="truncate">Administración de la plataforma</span></p>
        <span className="flex shrink-0 items-center gap-1"><ThemePicker /><Link href="/" className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-body transition-colors hover:bg-surface-card"><Icon name="arrowLeft" className="size-4" />Volver a la app</Link></span>
      </div>
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 lg:py-8 sm:px-6">{children}</main>
    </div>
  );
}
