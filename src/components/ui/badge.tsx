import { cn } from "@/lib/cn";

const tones = {
  neutral: "bg-surface-card text-ink",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  error: "bg-error-bg text-error",
  coral: "bg-primary-strong text-on-primary",
} as const;

const icons = { neutral: "", success: "✓", warning: "!", error: "✕", coral: "" } as const;

/** Status tones always carry an icon glyph + text, never color alone. */
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-[13px] font-medium", tones[tone])}>
      <span aria-hidden="true">{icons[tone]}</span>
      {children}
    </span>
  );
}
