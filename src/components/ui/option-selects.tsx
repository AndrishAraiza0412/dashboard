// Grouped selects for currency and time zone; the saved value is kept even when it is not in the list.
import { SelectField } from "@/components/ui/input";
import { currencyGroups, timezoneGroups, withCurrent, type Group } from "@/lib/options";

function GroupedSelect({ id, name, label, defaultValue, groups }: { id: string; name: string; label: string; defaultValue: string; groups: Group[] }) {
  return (
    <SelectField id={id} name={name} label={label} defaultValue={defaultValue} required>
      {withCurrent(groups, defaultValue).map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </SelectField>
  );
}

export const CurrencySelect = (p: { id: string; name?: string; label?: string; defaultValue: string }) => (
  <GroupedSelect id={p.id} name={p.name ?? "currency"} label={p.label ?? "Moneda"} defaultValue={p.defaultValue} groups={currencyGroups()} />
);

export const TimezoneSelect = (p: { id: string; name?: string; label?: string; defaultValue: string }) => (
  <GroupedSelect id={p.id} name={p.name ?? "timezone"} label={p.label ?? "Zona horaria"} defaultValue={p.defaultValue} groups={timezoneGroups()} />
);
