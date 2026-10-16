import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, admin, asUser, cleanup, closeAll, createOrg, createProduct, createUser, emailOf, runtime } from "./helpers";

// Migration 0009: the one-statement request context and the per-org change pings for live updates.
let orgA: string, orgB: string, member: string, viewer: string, outsider: string;

beforeAll(async () => {
  [member, viewer, outsider] = await Promise.all([createUser(), createUser(), createUser()]);
  [orgA, orgB] = [await createOrg(), await createOrg()];
  await addMember(orgA, member, "member");
  await addMember(orgA, viewer, "viewer");
  await addMember(orgB, outsider, "admin");
});

afterAll(async () => {
  await cleanup();
  await closeAll();
});

const claims = (user: string) => JSON.stringify({ sub: user, role: "authenticated", email: emailOf(user) });
const slugOf = async (org: string) => (await admin`select slug from organizations where id = ${org}`)[0].slug as string;
// Exactly what loadOrg() runs as its first statement, as the runtime role.
const context = async (user: string, slug: string | null) =>
  (await runtime.begin((tx) => tx`select set_config('role', 'authenticated', true), private.app_context(${claims(user)}, ${slug}) as ctx`))[0].ctx;

describe("private.app_context", () => {
  it("returns the caller's membership and organizations, nothing for other orgs", async () => {
    const slugA = await slugOf(orgA);
    const ctx = await context(viewer, slugA);
    expect(ctx.org).toMatchObject({ orgId: orgA, slug: slugA, role: "viewer", userId: viewer });
    expect(ctx.orgs.map((o: { slug: string }) => o.slug)).toEqual([slugA]);
    expect((await context(outsider, slugA)).org).toBeNull();
  });

  it("hides suspended organizations, like RLS", async () => {
    const org = await createOrg();
    await addMember(org, member, "admin");
    await admin`update organizations set suspended_at = now() where id = ${org}`;
    const ctx = await context(member, await slugOf(org));
    expect(ctx.org).toBeNull();
    expect(ctx.orgs.map((o: { slug: string }) => o.slug)).not.toContain(await slugOf(org));
  });

  it("cannot be called by signed-in users directly (only the server role)", async () => {
    await expect(asUser(member, (tx) => tx`select private.app_context(${claims(outsider)}, null)`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("change pings", () => {
  // realtime.messages is partitioned by day and the Realtime service creates the partitions once a client connects.
  // On a project (or CI stack) nobody has subscribed to yet there are none and pings are dropped with a warning,
  // so connect once and wait for today's partition.
  beforeAll(async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const channel = supabase.channel("integration-wake").subscribe();
    try {
      for (let i = 0; i < 60; i++) {
        const [{ ok }] = await admin`select exists (select 1 from pg_inherits i join pg_class c on c.oid = i.inhrelid
          where i.inhparent = 'realtime.messages'::regclass and c.relname = 'messages_' || to_char(now() at time zone 'utc', 'YYYY_MM_DD')) as ok`;
        if (ok) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("Realtime did not create today's realtime.messages partition");
    } finally {
      await supabase.removeChannel(channel);
    }
  }, 40_000);

  // What Realtime runs to authorize a subscriber of a private channel: RLS on realtime.messages with the topic set.
  const visibleTo = async (user: string, topic: string, since: Date) =>
    asUser(user, async (tx) => {
      await tx`select set_config('realtime.topic', ${topic}, true)`;
      return tx`select payload from realtime.messages where topic = ${topic} and inserted_at >= ${since}`;
    });

  it("every write sends 'org:<id>' a ping with entity names only, readable by that org's members only", async () => {
    const since = (await admin`select now() as t`)[0].t as Date;
    await createProduct(orgA);
    const topic = `org:${orgA}`;
    const rows = await admin`select payload, event, private from realtime.messages where topic = ${topic} and inserted_at >= ${since}`;
    const ping = rows.find((r) => r.payload.entities.includes("products"));
    expect(ping).toMatchObject({ event: "change", private: true });
    expect(Object.keys(ping!.payload).sort()).toEqual(["entities", "id"]); // no row data (id is the message id realtime.send adds)

    expect((await visibleTo(viewer, topic, since)).length).toBeGreaterThan(0);
    expect((await visibleTo(outsider, topic, since)).length).toBe(0);
  });
});
