import { ThemePicker } from "@/components/shell/theme-picker";
import { BrandMark } from "@/components/ui/icons";
import { APP_NAME } from "@/lib/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--surface-card),var(--canvas)_60%)] px-4 py-12">
      <div className="absolute right-4 top-4"><ThemePicker /></div>
      <div className="fade-in w-full max-w-sm">
        <p className="mb-6 flex items-center justify-center gap-3 font-serif text-[28px] font-medium leading-none tracking-[-0.3px] text-ink"><BrandMark className="size-10" />{APP_NAME}</p>
        <div className="rounded-xl border border-hairline bg-canvas p-6 shadow-lg shadow-black/5 sm:p-8">{children}</div>
      </div>
    </main>
  );
}
