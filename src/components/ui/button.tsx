import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerOutline";

const variants: Record<Variant, string> = {
  primary: "bg-primary-strong text-on-primary hover:bg-primary-hover active:bg-primary-active disabled:bg-primary-disabled disabled:text-muted",
  secondary: "bg-canvas text-ink border border-hairline hover:bg-surface-soft disabled:text-muted",
  ghost: "text-body hover:bg-surface-card disabled:text-muted",
  danger: "bg-error text-on-primary hover:opacity-90 disabled:opacity-50",
  dangerOutline: "bg-canvas text-error border border-hairline hover:bg-error-bg disabled:opacity-50",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
