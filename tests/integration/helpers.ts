import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

// `admin` is the owner role (bypasses RLS) and is only used to build fixtures and to read back
// what happened. Everything under test goes through `asUser`, which mirrors withOrg():
// app_rls connection -> set_config(claims) -> set local role authenticated.
export const admin = postgres(process.env.DATABASE_URL_MIGRATE!, { prepare: false, max: 3 });
export const runtime = postgres(process.env.DATABASE_URL!, { prepare: false, max: 6 });

export type Tx = postgres.TransactionSql;

export const emailOf = (id: string) => `${id}@test.local`;

export function asUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: { email?: string; requestId?: string } = {},
): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", email: opts.email ?? emailOf(userId) });
  return runtime.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    if (opts.requestId) await tx`select set_config('app.request_id', ${opts.requestId}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}

const created = { users: [] as string[], orgs: [] as string[] };

export async function createUser(opts: { confirmed?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await admin`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${emailOf(id)}, '',
            ${opts.confirmed === false ? null : new Date()}, '{}', '{}', now(), now())`;
  created.users.push(id);
  return id;
}

export async function createOrg(opts: { demo?: boolean } = {}): Promise<string> {
  const slug = `t-${randomUUID().slice(0, 12)}`;
  const [{ id }] = await admin`
    insert into organizations (name, slug, is_demo) values (${slug}, ${slug}, ${opts.demo ?? false}) returning id`;
  created.orgs.push(id);
  return id;
}

export const addMember = (orgId: string, userId: string, role: "admin" | "member" | "viewer") =>
  admin`insert into memberships (org_id, user_id, role) values (${orgId}, ${userId}, ${role})`;

/** Fixtures insert as the owner role, so triggers that only constrain end users do not interfere. */
export async function createProduct(orgId: string, opts: { stock?: number; price?: string; sku?: string } = {}) {
  const sku = opts.sku ?? `sku-${randomUUID().slice(0, 8)}`;
  const [{ id }] = await admin`
    insert into products (org_id, sku, name, price, stock_qty)
    values (${orgId}, ${sku}, ${sku}, ${opts.price ?? "10.00"}, ${opts.stock ?? 0}) returning id`;
  return id as string;
}

export async function createCustomer(orgId: string) {
  const [{ id }] = await admin`insert into customers (org_id, name) values (${orgId}, 'cliente') returning id`;
  return id as string;
}

export async function createDraftOrder(orgId: string, lines: { productId: string; qty: number; price?: string }[]) {
  const [{ id }] = await admin`insert into orders (org_id) values (${orgId}) returning id`;
  for (const l of lines) {
    await admin`
      insert into order_items (org_id, order_id, product_id, qty, unit_price)
      values (${orgId}, ${id}, ${l.productId}, ${l.qty}, ${l.price ?? "10.00"})`;
  }
  return id as string;
}

export const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function stockOf(productId: string): Promise<number> {
  const [{ stock_qty }] = await admin`select stock_qty from products where id = ${productId}`;
  return stock_qty;
}

export async function cleanup() {
  for (const orgId of created.orgs) {
    await admin.begin(async (tx) => {
      await tx`select set_config('app.deleting_org', ${orgId}, true)`;
      await tx`delete from organizations where id = ${orgId}`;
    });
    await admin`delete from audit_log where org_id = ${orgId}`;
  }
  if (created.users.length) {
    await admin`delete from audit_log where actor_id = any(${created.users})`;
    await admin`delete from platform_admins where user_id = any(${created.users})`;
    await admin`delete from auth.users where id = any(${created.users})`;
  }
  created.orgs.length = 0;
  created.users.length = 0;
}

export async function closeAll() {
  await admin.end();
  await runtime.end();
}
