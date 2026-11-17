// Tests for the audit-log text helpers: Spanish field names, the record's subject and fallbacks for unknown values.
import { describe, expect, it } from "vitest";
import { actionVerb, changedFields, entityLabel, subject } from "@/lib/activity-text";

describe("activity text", () => {
  it("names the changed columns in Spanish and ignores bookkeeping ones", () => {
    const diff = { old: { id: "1", org_id: "o", created_at: "x", name: "Taza", price: "10.00", stock_qty: 5 }, new: { id: "1", org_id: "o", created_at: "x", name: "Taza", price: "12.00", stock_qty: 4 } };
    expect(changedFields(diff)).toEqual(["precio", "stock"]);
  });

  it("describes the record by its most useful field", () => {
    expect(subject("products", { old: null, new: { name: "Taza", sku: "T-1" } })).toBe("Taza");
    expect(subject("orders", { old: null, new: { number: 7 } })).toBe("#7");
    expect(subject("orders", { old: null, new: { number: null } })).toBe("en borrador");
    expect(subject("stock_movements", { old: null, new: { delta: -3, reason: "sale" } })).toBe("-3 (venta)");
    expect(subject("customers", { old: { email: "a@b.c" }, new: null })).toBe("a@b.c");
    expect(subject("memberships", { old: { role: "member" }, new: { role: "viewer" } })).toBe("(solo lectura)");
  });

  it("falls back to the raw value for unknown entities, actions and columns", () => {
    expect(entityLabel("weird")).toBe("weird");
    expect(actionVerb("insert")).toBe("creó");
    expect(actionVerb("truncate")).toBe("truncate");
    expect(changedFields({ old: { foo: 1 }, new: { foo: 2 } })).toEqual(["foo"]);
    expect(changedFields(null)).toEqual([]);
  });
});
