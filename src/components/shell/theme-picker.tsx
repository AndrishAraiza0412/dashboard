"use client";

import { useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

// Swatches mirror --primary-strong and --surface-card per theme in tokens.css: [light accent, light surface, dark accent, dark surface].
const PALETTES = [
  { id: "coral", label: "Coral", c: ["#a8634c", "#efe9de", "#e0906f", "#262522"] },
  { id: "oceano", label: "Océano", c: ["#1f5f9e", "#e4edf6", "#6aa8e8", "#202731"] },
  { id: "bosque", label: "Bosque", c: ["#2f6b4f", "#e2eee6", "#5fbf8f", "#202923"] },
  { id: "uva", label: "Uva", c: ["#6447b8", "#ece7f7", "#a48cf0", "#25212f"] },
  { id: "grafito", label: "Grafito", c: ["#3d3d3a", "#e8e8e5", "#d6d3cc", "#232323"] },
] as const;
const THEMES: { id: Pref; label: string; icon: IconName }[] = [
  { id: "light", label: "Claro", icon: "sun" },
  { id: "dark", label: "Oscuro", icon: "moon" },
  { id: "system", label: "Sistema", icon: "monitor" },
];
type Pref = "light" | "dark" | "system";
type Style = "solid" | "glass";
const STYLES: { id: Style; label: string; icon: IconName }[] = [
  { id: "solid", label: "Sólido", icon: "square" },
  { id: "glass", label: "Cristal", icon: "sparkles" },
];

/**
 * Same logic as the inline script in the root layout (which runs before first paint, so there is no flash).
 * the choice lives in this browser's localStorage; move it to the profile if it should follow the user across devices.
 */
function apply(pref: Pref, palette: string, style: Style) {
  const d = document.documentElement;
  try {
    localStorage.setItem("theme", pref);
    localStorage.setItem("palette", palette);
    localStorage.setItem("style", style);
  } catch {}
  d.dataset.themePref = pref;
  d.dataset.theme = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  d.dataset.palette = palette;
  d.dataset.style = style;
}

const subscribe = (cb: () => void) => {
  const o = new MutationObserver(cb);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-pref", "data-palette", "data-style"] });
  return () => o.disconnect();
};
const snapshot = () => {
  const d = document.documentElement.dataset;
  return `${d.themePref ?? "system"}|${d.theme ?? "light"}|${d.palette ?? "coral"}|${d.style ?? "solid"}`;
};

export function ThemePicker() {
  const [pref, theme, palette, style] = useSyncExternalStore(subscribe, snapshot, () => "system|light|coral|solid").split("|") as [Pref, "light" | "dark", string, Style];
  const dark = theme === "dark";
  const deep = dark || style === "glass"; // glass uses the dark accents in both modes
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => apply(pref, palette, style === "glass" ? "solid" : "glass")}
        aria-pressed={style === "glass"}
        aria-label="Estilo cristal"
        title="Estilo cristal"
        className="grid size-9 cursor-pointer place-items-center rounded-full text-body transition-colors hover:bg-surface-card hover:text-ink aria-pressed:text-primary-text"
      >
        <Icon name="sparkles" />
      </button>
      <button
        type="button"
        onClick={() => apply(dark ? "light" : "dark", palette, style)}
        aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        className="grid size-9 cursor-pointer place-items-center rounded-full text-body transition-colors hover:bg-surface-card hover:text-ink"
      >
        <Icon name={dark ? "sun" : "moon"} />
      </button>
      <details className="relative">
        <summary aria-label="Apariencia" className="grid size-9 cursor-pointer list-none place-items-center rounded-full text-body transition-colors hover:bg-surface-card hover:text-ink [&::-webkit-details-marker]:hidden">
          <Icon name="palette" />
        </summary>
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-hairline bg-canvas p-3 shadow-lg">
          <p className="px-1 text-[12px] font-medium uppercase tracking-wide text-muted">Modo</p>
          <div role="group" aria-label="Modo" className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-surface-soft p-1">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={pref === t.id}
                onClick={() => apply(t.id, palette, style)}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-md py-2 text-[12px] text-body transition-colors hover:text-ink aria-pressed:bg-canvas aria-pressed:font-medium aria-pressed:text-ink aria-pressed:shadow-sm"
              >
                <Icon name={t.icon} className="size-4" />
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-4 px-1 text-[12px] font-medium uppercase tracking-wide text-muted">Estilo</p>
          <div role="group" aria-label="Estilo" className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-surface-soft p-1">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={style === s.id}
                onClick={() => apply(pref, palette, s.id)}
                className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md py-2 text-[12px] text-body transition-colors hover:text-ink aria-pressed:bg-canvas aria-pressed:font-medium aria-pressed:text-ink aria-pressed:shadow-sm"
              >
                <Icon name={s.icon} className="size-4" />
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-4 px-1 text-[12px] font-medium uppercase tracking-wide text-muted">Color</p>
          <div role="group" aria-label="Color" className="mt-2 grid grid-cols-5 gap-1">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={palette === p.id}
                onClick={() => apply(pref, p.id, style)}
                className="group flex cursor-pointer flex-col items-center gap-1.5 rounded-md py-1.5 text-[11.5px] text-body transition-colors hover:bg-surface-soft aria-pressed:font-medium aria-pressed:text-ink"
              >
                <span
                  aria-hidden="true"
                  className={cn("size-7 rounded-full ring-2 ring-offset-2 ring-offset-canvas transition-shadow", palette === p.id ? "ring-ink" : "ring-transparent group-hover:ring-hairline")}
                  style={{ background: `linear-gradient(135deg, ${p.c[deep ? 2 : 0]} 50%, ${p.c[deep ? 3 : 1]} 50%)` }}
                />
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
