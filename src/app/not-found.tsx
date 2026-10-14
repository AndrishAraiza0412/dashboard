import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-32 text-center">
      <h1 className="font-serif text-[36px] leading-[1.15] tracking-[-0.5px] text-ink">No encontramos esa página</h1>
      <p className="mt-2 text-muted">Puede que el enlace sea incorrecto o que no tengas acceso.</p>
      <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-md bg-primary-strong px-5 text-sm font-medium text-on-primary hover:bg-primary-hover">
        Ir al inicio
      </Link>
    </main>
  );
}
