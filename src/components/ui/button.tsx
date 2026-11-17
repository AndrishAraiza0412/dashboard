// Button with the design system's variants (primary, secondary, ghost, danger).
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerOutline";

const variants: Record<Variant, string> = {
  primary: "bg-primary-strong text-on-primary shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(0_0_0/0.12)] hover:bg-primary-hover active:bg-primary-active disabled:bg-primary-disabled disabled:text-muted",
  secondary: "bg-canvas text-ink border border-hairline shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:border-surface-strong hover:bg-surface-soft disabled:text-muted",
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
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-5 text-sm font-medium transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] cursor-pointer disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
