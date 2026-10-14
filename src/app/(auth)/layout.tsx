export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center font-serif text-[28px] leading-none tracking-[-0.3px] text-ink">Dashboard</p>
        <div className="rounded-lg border border-hairline bg-surface-card p-6">{children}</div>
      </div>
    </main>
  );
}
