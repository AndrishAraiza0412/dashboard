import { cn } from "@/lib/cn";

export function Field({
  label,
  id,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        className={cn(
          "h-10 w-full rounded-md border border-hairline bg-canvas px-3.5 text-ink placeholder:text-muted-soft",
          "focus:border-primary-strong focus:outline-none focus:ring-[3px] focus:ring-[var(--focus-ring)]",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function SelectField({
  label,
  id,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      <select
        id={id}
        className={cn(
          "h-10 w-full rounded-md border border-hairline bg-canvas px-3 text-ink",
          "focus:border-primary-strong focus:outline-none focus:ring-[3px] focus:ring-[var(--focus-ring)]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
