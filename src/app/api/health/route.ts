// Health check: 200 if the app can reach the database, 503 otherwise (used by the deploy smoke test).
import { connection } from "next/server";
import { pingDb } from "@/server/db/with-org";

export async function GET() {
  await connection();
  const ok = await pingDb();
  return Response.json({ status: ok ? "ok" : "error" }, { status: ok ? 200 : 503 });
}
