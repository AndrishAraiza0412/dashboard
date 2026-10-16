import { cn } from "@/lib/cn";

const tones = {
  neutral: "bg-surface-card text-ink ring-1 ring-inset ring-hairline",
  success: "bg-success-bg text-success ring-1 ring-inset ring-success/20",
  warning: "bg-warning-bg text-warning ring-1 ring-inset ring-warning/20",
  error: "bg-error-bg text-error ring-1 ring-inset ring-error/20",
  coral: "bg-primary-strong text-on-primary",
} as const;

const icons = { neutral: "", success: "✓", warning: "!", error: "✕", coral: "" } as const;

/** Status tones always carry an icon glyph + text, never color alone. */
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-medium", tones[tone])}>
      {icons[tone] && <span aria-hidden="true" className="text-[11px]">{icons[tone]}</span>}
      {children}
    </span>
  );
}
