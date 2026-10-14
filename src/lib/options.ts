// Choice lists for organization settings. Built once from Intl, so they follow the runtime's data (no hand-kept tables).
type Option = { value: string; label: string };
export type Group = { label: string; options: Option[] };

const COMMON_CURRENCIES = ["MXN", "USD", "EUR", "COP", "ARS", "CLP", "PEN", "BRL", "UYU", "GTQ", "CRC", "DOP", "PAB", "BOB", "PYG", "HNL", "NIO", "VES", "CAD", "GBP"];
const COMMON_ZONES = [
  "America/Mexico_City", "America/Cancun", "America/Tijuana", "America/Bogota", "America/Lima", "America/Santiago",
  "America/Argentina/Buenos_Aires", "America/Sao_Paulo", "America/Montevideo", "America/Guatemala", "America/Costa_Rica",
  "America/Panama", "America/Caracas", "America/La_Paz", "America/Asuncion", "America/Tegucigalpa", "America/Managua",
  "America/Santo_Domingo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/Madrid", "UTC",
];
const REGIONS: Record<string, string> = {
  America: "América", Europe: "Europa", Asia: "Asia", Africa: "África", Pacific: "Pacífico", Atlantic: "Atlántico",
  Indian: "Índico", Australia: "Australia", Antarctica: "Antártida", Arctic: "Ártico",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function buildCurrencies(): Group[] {
  const names = new Intl.DisplayNames(["es-MX"], { type: "currency" });
  const label = (code: string) => `${code} — ${cap(names.of(code) ?? code)}`;
  const all = Intl.supportedValuesOf("currency");
  const common = COMMON_CURRENCIES.filter((c) => all.includes(c));
  const rest = all.filter((c) => !common.includes(c)).sort((a, b) => (names.of(a) ?? a).localeCompare(names.of(b) ?? b, "es"));
  return [
    { label: "Más usadas", options: common.map((c) => ({ value: c, label: label(c) })) },
    { label: "Todas las monedas", options: rest.map((c) => ({ value: c, label: label(c) })) },
  ];
}

function offsetLabel(zone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  return part.replace("GMT", "UTC").replace("-", "−") || "UTC";
}

function buildZones(): Group[] {
  const label = (zone: string) => (zone === "UTC" ? "UTC (hora universal)" : `${zone.split("/").slice(1).join(" / ").replaceAll("_", " ")} (${offsetLabel(zone)})`);
  const all = Intl.supportedValuesOf("timeZone");
  const common = COMMON_ZONES.filter((z) => z === "UTC" || all.includes(z));
  const byRegion = new Map<string, Option[]>();
  for (const z of all) {
    if (common.includes(z)) continue;
    const region = REGIONS[z.split("/")[0]];
    if (!region) continue;
    byRegion.set(region, [...(byRegion.get(region) ?? []), { value: z, label: label(z) }]);
  }
  return [
    { label: "Más usadas", options: common.map((z) => ({ value: z, label: label(z) })) },
    ...[...byRegion].sort(([a], [b]) => a.localeCompare(b, "es")).map(([region, options]) => ({ label: region, options })),
  ];
}

let currencies: Group[] | undefined;
let zones: Group[] | undefined;
export const currencyGroups = () => (currencies ??= buildCurrencies());
export const timezoneGroups = () => (zones ??= buildZones());

/** The saved value always stays selectable, even if it is not in the list (e.g. an older zone alias). */
export function withCurrent(groups: Group[], current: string): Group[] {
  if (!current || groups.some((g) => g.options.some((o) => o.value === current))) return groups;
  return [{ label: "Actual", options: [{ value: current, label: current }] }, ...groups];
}
