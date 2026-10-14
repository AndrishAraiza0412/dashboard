import type { Instrumentation } from "next";
import { formatError } from "@/server/log";

// Next calls this for every unhandled error in pages, Server Actions and route handlers
// (not for notFound()/redirect(), which are control flow).
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  console.error(formatError(err, request, context));
};
