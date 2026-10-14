import { Field, SelectField } from "@/components/ui/input";
import type { products } from "@/db/schema";

type Product = typeof products.$inferSelect;

/** Inputs shared by the create and edit forms. Prices stay strings end to end. */
export function ProductFields({ categories, p }: { categories: { id: string; name: string }[]; p?: Product }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="sku" name="sku" label="SKU" defaultValue={p?.sku} required maxLength={40} autoComplete="off" spellCheck={false} />
        <Field id="name" name="name" label="Nombre" defaultValue={p?.name} required maxLength={120} />
      </div>
      <SelectField id="categoryId" name="categoryId" label="Categoría" defaultValue={p?.categoryId ?? ""}>
        <option value="">Sin categoría</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="price" name="price" label="Precio" inputMode="decimal" defaultValue={p?.price ?? "0.00"} required />
        <Field id="cost" name="cost" label="Costo" inputMode="decimal" defaultValue={p?.cost ?? "0.00"} required />
        <Field id="reorderLevel" name="reorderLevel" label="Avisar con stock ≤" type="number" min={0} defaultValue={p?.reorderLevel ?? 0} required />
      </div>
    </>
  );
}
