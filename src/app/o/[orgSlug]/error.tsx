"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function OrgError({ error, reset }: { error: Error; reset: () => void }) {
  const forbidden = error.message === "forbidden";
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="font-serif text-[28px] tracking-[-0.3px] text-ink">{forbidden ? "No tienes permiso" : "Algo salió mal"}</h1>
      <p className="mt-2 text-muted">{forbidden ? "Tu rol no permite hacer esto. Pide acceso a un administrador." : "Inténtalo de nuevo en un momento."}</p>
      <div className="mt-6 flex justify-center gap-2">
        {!forbidden && <Button onClick={reset}>Reintentar</Button>}
        <Link href="/" className="inline-flex h-10 items-center rounded-md px-5 text-sm font-medium text-body hover:bg-surface-card">
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
