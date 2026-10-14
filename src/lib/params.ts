type Raw = string | string[] | undefined;

export const one = (v: Raw): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;

/** A value from a fixed list (sort order, filter...), or the fallback when the URL was edited by hand. */
export const choice = <T extends string>(v: Raw, allowed: readonly T[], fallback: T): T => allowed.find((a) => a === one(v)) ?? fallback;

export const pageParam = (v: Raw) => Math.max(1, Math.floor(Number(one(v))) || 1);

export const PAGE_SIZES = [20, 50, 100] as const;
export const sizeParam = (v: Raw): (typeof PAGE_SIZES)[number] => PAGE_SIZES.find((s) => String(s) === one(v)) ?? 20;

export const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isIsoDay = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Builds `?a=1&b=2` from the defined, non-default entries. */
export function query(params: Record<string, string | number | undefined>, defaults: Record<string, string | number> = {}): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && String(v) !== String(defaults[k] ?? "")) u.set(k, String(v));
  return u.size ? `?${u}` : "";
}
