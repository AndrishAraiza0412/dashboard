import { describe, expect, it } from "vitest";
import { missingDependency } from "@/lib/modules";

describe("missingDependency", () => {
  it("names the module whose dependency is off", () => {
    expect(missingDependency(["inventory", "sales", "purchases"])).toBeNull();
    expect(missingDependency(["inventory"])).toBeNull();
    expect(missingDependency(["sales"])).toBe("Ventas necesita el módulo de Inventario.");
    expect(missingDependency(["purchases"])).toBe("Compras necesita el módulo de Inventario.");
  });
});
