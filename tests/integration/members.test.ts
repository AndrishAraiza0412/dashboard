import { afterAll, describe, expect, it } from "vitest";
import { addMember, admin, asUser, cleanup, closeAll, createOrg, createUser, sha256hex } from "./helpers";
import { randomUUID } from "node:crypto";

// AC13 invitations, AC14 last admin.
afterAll(async () => {
  await cleanup();
  await closeAll();
});

async function invite(orgId: string, byAdmin: string, email: string, role: "admin" | "member" | "viewer" = "member") {
  const token = randomUUID() + randomUUID();
  await asUser(byAdmin, (tx) =>
    tx`insert into invitations (org_id, email, role, token_hash) values (${orgId}, ${email}, ${role}, ${sha256hex(token)})`);
  return token;
}
const accept = (user: string, token: string, email?: string) =>
  asUser(user, (tx) => tx`select public.accept_invitation(${token}) as org`, { email });
const emailOf = (id: string) => `${id}@test.local`;

describe("AC13 invitations", () => {
  it("a valid invitation creates exactly one membership with the invited role and is single-use", async () => {
    const org = await createOrg();
    const owner = await createUser();
    await addMember(org, owner, "admin");
    const invitee = await createUser();
    const token = await invite(org, owner, emailOf(invitee), "viewer");

    const [{ org: joined }] = await accept(invitee, token);
    expect(joined).toBe(org);
    const m = await admin`select role from memberships where org_id = ${org} and user_id = ${invitee}`;
    expect(m).toEqual([{ role: "viewer" }]);
    const [inv] = await admin`select accepted_at from invitations where token_hash = ${sha256hex(token)}`;
    expect(inv.accepted_at).not.toBeNull();

    await expect(accept(invitee, token)).rejects.toThrow(/invalid or expired/);
    const count = await admin`select 1 from memberships where org_id = ${org} and user_id = ${invitee}`;
    expect(count.length).toBe(1);
  });

  it("the email match ignores case", async () => {
    const org = await createOrg();
    const owner = await createUser();
    await addMember(org, owner, "admin");
    const invitee = await createUser();
    const token = await invite(org, owner, emailOf(invitee).toUpperCase());
    await accept(invitee, token);
    expect((await admin`select 1 from memberships where org_id = ${org} and user_id = ${invitee}`).length).toBe(1);
  });

  it("an expired invitation creates no membership", async () => {
    const org = await createOrg();
    const owner = await createUser();
    await addMember(org, owner, "admin");
    const invitee = await createUser();
    const token = await invite(org, owner, emailOf(invitee));
    await admin`update invitations set expires_at = now() - interval '1 minute' where token_hash = ${sha256hex(token)}`;
    await expect(accept(invitee, token)).rejects.toThrow(/invalid or expired/);
    expect((await admin`select 1 from memberships where org_id = ${org} and user_id = ${invitee}`).length).toBe(0);
  });

  it("a different email cannot use the token", async () => {
    const org = await createOrg();
    const owner = await createUser();
    await addMember(org, owner, "admin");
    const invitee = await createUser();
    const stranger = await createUser();
    const token = await invite(org, owner, emailOf(invitee));
    await expect(accept(stranger, token)).rejects.toThrow(/invalid or expired/);
    expect((await admin`select 1 from memberships where org_id = ${org} and user_id = ${stranger}`).length).toBe(0);
    const [inv] = await admin`select accepted_at from invitations where token_hash = ${sha256hex(token)}`;
    expect(inv.accepted_at).toBeNull();
  });

  it("an unconfirmed email cannot accept", async () => {
    const org = await createOrg();
    const owner = await createUser();
    await addMember(org, owner, "admin");
    const invitee = await createUser({ confirmed: false });
    const token = await invite(org, owner, emailOf(invitee));
    await expect(accept(invitee, token)).rejects.toThrow(/email not confirmed/);
    expect((await admin`select 1 from memberships where org_id = ${org} and user_id = ${invitee}`).length).toBe(0);
  });

  it("an unknown token is rejected", async () => {
    const user = await createUser();
    await expect(accept(user, "not-a-real-token")).rejects.toThrow(/invalid or expired/);
  });

  it("a second open invitation for the same email is refused", async () => {
    const org = await createOrg();
    const owner = await createUser();
    await addMember(org, owner, "admin");
    await invite(org, owner, "dup@test.local");
    await expect(invite(org, owner, "DUP@test.local")).rejects.toThrow(/invitations_open_email_key/);
  });
});

describe("AC14 an organization always keeps an admin", () => {
  it("the only admin cannot demote, remove or leave", async () => {
    const org = await createOrg();
    const sole = await createUser();
    const other = await createUser();
    await addMember(org, sole, "admin");
    await addMember(org, other, "member");

    await expect(asUser(sole, (tx) => tx`select public.change_member_role(${org}, ${sole}, 'viewer')`)).rejects.toThrow(/at least one admin/);
    await expect(asUser(sole, (tx) => tx`select public.remove_member(${org}, ${sole})`)).rejects.toThrow(/at least one admin/);
    await expect(asUser(sole, (tx) => tx`select public.leave_org(${org})`)).rejects.toThrow(/at least one admin/);
    const [{ role }] = await admin`select role from memberships where org_id = ${org} and user_id = ${sole}`;
    expect(role).toBe("admin");
  });

  it("two admins demoting each other at once: exactly one wins and one admin remains", async () => {
    const org = await createOrg();
    const a1 = await createUser();
    const a2 = await createUser();
    await addMember(org, a1, "admin");
    await addMember(org, a2, "admin");

    const results = await Promise.allSettled([
      asUser(a1, (tx) => tx`select public.change_member_role(${org}, ${a2}, 'viewer')`),
      asUser(a2, (tx) => tx`select public.change_member_role(${org}, ${a1}, 'viewer')`),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const admins = await admin`select 1 from memberships where org_id = ${org} and role = 'admin'`;
    expect(admins.length).toBe(1);
  });

  it("a non-last admin can leave, and members and viewers can leave", async () => {
    const org = await createOrg();
    const a1 = await createUser();
    const a2 = await createUser();
    const viewer = await createUser();
    await addMember(org, a1, "admin");
    await addMember(org, a2, "admin");
    await addMember(org, viewer, "viewer");

    await asUser(viewer, (tx) => tx`select public.leave_org(${org})`);
    await asUser(a2, (tx) => tx`select public.leave_org(${org})`);
    const left = await admin`select user_id from memberships where org_id = ${org}`;
    expect(left.map((m) => m.user_id)).toEqual([a1]);
  });

  it("promoting then demoting works, and admins can remove other members", async () => {
    const org = await createOrg();
    const boss = await createUser();
    const worker = await createUser();
    await addMember(org, boss, "admin");
    await addMember(org, worker, "member");
    await asUser(boss, (tx) => tx`select public.change_member_role(${org}, ${worker}, 'admin')`);
    await asUser(boss, (tx) => tx`select public.change_member_role(${org}, ${worker}, 'viewer')`);
    await asUser(boss, (tx) => tx`select public.remove_member(${org}, ${worker})`);
    expect((await admin`select 1 from memberships where org_id = ${org}`).length).toBe(1);
  });

  it("nobody can leave the demo organization", async () => {
    const org = await createOrg({ demo: true });
    const a = await createUser();
    const v = await createUser();
    await addMember(org, a, "admin");
    await addMember(org, v, "viewer");
    await expect(asUser(v, (tx) => tx`select public.leave_org(${org})`)).rejects.toThrow(/demo/);
  });
});
