type RequestInfo = { path?: string; headers?: Record<string, string | string[] | undefined> };
type ErrorContext = { routerKind?: string; routePath?: string; routeType?: string };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * One JSON line per unhandled server error. Only the request id, the route template (never the real URL or
 * params), the kind of handler and a code: no messages, emails or ids, which could carry personal data.
 */
export function formatError(err: unknown, request: RequestInfo, context: ErrorContext): string {
  const e = err as { cause?: { code?: string }; digest?: string; name?: string };
  return JSON.stringify({
    level: "error",
    request_id: first(request.headers?.["x-request-id"]) ?? null,
    action: context.routePath ?? null,
    kind: context.routeType ?? null,
    error_code: e?.cause?.code ?? e?.name ?? "unknown",
    digest: e?.digest ?? null,
  });
}
