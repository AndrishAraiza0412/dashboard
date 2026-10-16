/**
 * The modules an organization can have, switched on per client from /admin. This list drives the admin checkboxes,
 * the sidebar and requireModule(). Adding one: a line here, its pages behind requireModule(ctx, "<id>"), and a
 * migration that adds the id to the organizations_modules_known check (src/db/schema.ts).
 */
export const MODULES = [
  { id: "inventory", label: "Inventario" },
  { id: "sales", label: "Ventas", requires: "inventory" },
  { id: "purchases", label: "Compras", requires: "inventory" },
] as const satisfies readonly { id: string; label: string; requires?: string }[];

export type ModuleId = (typeof MODULES)[number]["id"];

/** The first module whose dependency is missing from `ids`, as a message for the admin. */
export function missingDependency(ids: readonly string[]): string | null {
  for (const m of MODULES) {
    if ("requires" in m && ids.includes(m.id) && !ids.includes(m.requires)) {
      return `${m.label} necesita el módulo de ${MODULES.find((x) => x.id === m.requires)!.label}.`;
    }
  }
  return null;
}
