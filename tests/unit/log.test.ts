import { describe, expect, it } from "vitest";
import { formatError } from "@/server/log";

describe("error log line", () => {
  it("is one JSON object with request id, route template and a code, and no message", () => {
    const err = Object.assign(new Error("secret@email.com failed"), { cause: { code: "23505" }, digest: "123" });
    const line = formatError(err, { path: "/o/acme/inventory/abc", headers: { "x-request-id": "r-1" } }, { routePath: "/o/[orgSlug]/inventory/[productId]", routeType: "action" });
    expect(JSON.parse(line)).toEqual({
      level: "error", request_id: "r-1", action: "/o/[orgSlug]/inventory/[productId]", kind: "action", error_code: "23505", digest: "123",
    });
    expect(line).not.toContain("secret");
    expect(line).not.toContain("acme");
  });

  it("falls back to the error name and nulls when the request has no id", () => {
    expect(JSON.parse(formatError(new TypeError("x"), {}, {}))).toMatchObject({ request_id: null, action: null, error_code: "TypeError" });
  });
});
