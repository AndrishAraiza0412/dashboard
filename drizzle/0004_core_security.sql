-- Core security layer: triggers, SECURITY DEFINER functions, grants and RLS policies.
-- Convention: every definer function has `set search_path = ''`, checks the caller's role from the
-- verified JWT (auth.uid()) against the object's own org, and is executable only by `authenticated`.

-- ======================================================================================
-- Helpers
-- ======================================================================================
create or replace function private.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()))
$$;
revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

-- ======================================================================================
-- Triggers
-- ======================================================================================

-- profiles follow auth.users (the trigger is fired by supabase_auth_admin, hence definer)
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end
$$;

create or replace function private.sync_user_email()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.sync_user_email();

insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Audit trail. Definer because authenticated has no INSERT on audit_log. Skipped during org deletion.
create or replace function private.audit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'token_hash' end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'token_hash' end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if coalesce(current_setting('app.deleting_org', true), '') <> '' then
    return null;
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff, request_id)
  values (
    case when tg_table_name = 'organizations' then (v_row ->> 'id')::uuid else (v_row ->> 'org_id')::uuid end,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    case when tg_table_name = 'memberships' then (v_row ->> 'org_id') || ':' || (v_row ->> 'user_id') else v_row ->> 'id' end,
    jsonb_build_object('old', v_old, 'new', v_new),
    nullif(current_setting('app.request_id', true), '')
  );
  return null;
end
$$;

do $$
declare t text;
begin
  foreach t in array array['organizations','memberships','invitations','categories','products','customers','orders','order_items','stock_movements']
  loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit()', t);
  end loop;
end
$$;

-- orders.total is derived from the lines, never supplied by the app
create or replace function private.recalc_order_total()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_order uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders
     set total = coalesce((select round(sum(line_total), 2) from public.order_items where order_id = v_order), 0)
   where id = v_order;
  return null;
end
$$;
drop trigger if exists recalc_total on public.order_items;
create trigger recalc_total after insert or update or delete on public.order_items
  for each row execute function private.recalc_order_total();

-- Columns that Drizzle must name in INSERT but that users must not forge. Only applied for
-- end-user roles so trusted definer functions and fixtures keep full control.
create or replace function private.force_product_defaults()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then new.stock_qty := 0; end if;
  return new;
end $$;

create or replace function private.force_order_defaults()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.number := null; new.status := 'draft'; new.total := 0; new.confirmed_at := null;
  end if;
  return new;
end $$;

create or replace function private.force_invitation_defaults()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.invited_by := (select auth.uid());
    new.expires_at := now() + interval '7 days';
    new.accepted_at := null;
  end if;
  return new;
end $$;

drop trigger if exists force_defaults on public.products;
create trigger force_defaults before insert on public.products
  for each row execute function private.force_product_defaults();
drop trigger if exists force_defaults on public.orders;
create trigger force_defaults before insert on public.orders
  for each row execute function private.force_order_defaults();
drop trigger if exists force_defaults on public.invitations;
create trigger force_defaults before insert on public.invitations
  for each row execute function private.force_invitation_defaults();

-- ======================================================================================
-- Business functions (SECURITY DEFINER)
-- ======================================================================================
create or replace function public.adjust_stock(
  p_product uuid, p_delta integer, p_reason public.movement_reason, p_note text default null
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_product public.products; v_new integer;
begin
  if p_reason not in ('restock', 'adjustment') then
    raise exception 'reason must be restock or adjustment' using errcode = 'P0001';
  end if;
  if p_delta = 0 then
    raise exception 'delta must not be zero' using errcode = 'P0001';
  end if;
  select * into v_product from public.products where id = p_product for update;
  if not found then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  if not private.has_role(v_product.org_id, '{admin,member}') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_new := v_product.stock_qty + p_delta;
  if v_new < 0 then
    raise exception 'stock cannot be negative' using errcode = 'P0001';
  end if;
  update public.products set stock_qty = v_new where id = p_product;
  insert into public.stock_movements (org_id, product_id, delta, reason, note)
  values (v_product.org_id, p_product, p_delta, p_reason, p_note);
  return v_new;
end
$$;

create or replace function public.confirm_order(p_order uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_order public.orders; v_item record; v_number integer;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if not private.has_role(v_order.org_id, '{admin,member}') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_order.status <> 'draft' then
    raise exception 'order is not a draft' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.order_items where order_id = p_order) then
    raise exception 'order has no items' using errcode = 'P0001';
  end if;

  -- lock products in a stable order to avoid deadlocks between concurrent orders
  perform 1 from public.products p
   where p.id in (select product_id from public.order_items where order_id = p_order)
   order by p.id for update;

  for v_item in
    select i.product_id, i.qty, p.stock_qty, p.name
      from public.order_items i join public.products p on p.id = i.product_id
     where i.order_id = p_order
     order by i.product_id
  loop
    if v_item.stock_qty < v_item.qty then
      raise exception 'insufficient stock for %', v_item.name using errcode = 'P0001';
    end if;
    update public.products set stock_qty = stock_qty - v_item.qty where id = v_item.product_id;
    insert into public.stock_movements (org_id, product_id, delta, reason, order_id)
    values (v_order.org_id, v_item.product_id, -v_item.qty, 'sale', p_order);
  end loop;

  insert into public.org_counters (org_id, next_order_no) values (v_order.org_id, 2)
  on conflict (org_id) do update set next_order_no = org_counters.next_order_no + 1
  returning next_order_no - 1 into v_number;

  update public.orders set status = 'confirmed', number = v_number, confirmed_at = now() where id = p_order;
  return v_number;
end
$$;

create or replace function public.cancel_order(p_order uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_order public.orders; v_item record;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if not private.has_role(v_order.org_id, '{admin,member}') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_order.status not in ('draft', 'confirmed') then
    raise exception 'order cannot be cancelled' using errcode = 'P0001';
  end if;

  if v_order.status = 'confirmed' then
    perform 1 from public.products p
     where p.id in (select product_id from public.order_items where order_id = p_order)
     order by p.id for update;
    for v_item in
      select product_id, qty from public.order_items where order_id = p_order order by product_id
    loop
      update public.products set stock_qty = stock_qty + v_item.qty where id = v_item.product_id;
      insert into public.stock_movements (org_id, product_id, delta, reason, order_id)
      values (v_order.org_id, v_item.product_id, v_item.qty, 'sale_cancel', p_order);
    end loop;
  end if;

  update public.orders set status = 'cancelled' where id = p_order;
end
$$;

create or replace function public.fulfill_order(p_order uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if not private.has_role(v_order.org_id, '{admin,member}') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_order.status <> 'confirmed' then
    raise exception 'only confirmed orders can be fulfilled' using errcode = 'P0001';
  end if;
  update public.orders set status = 'fulfilled' where id = p_order;
end
$$;

-- Membership changes lock the organization row first, so two admins demoting each other
-- at the same time cannot leave the org without an admin.
create or replace function public.change_member_role(p_org uuid, p_user uuid, p_role public.member_role)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform 1 from public.organizations where id = p_org for update;
  if not private.has_role(p_org, '{admin}') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.memberships set role = p_role where org_id = p_org and user_id = p_user;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.memberships where org_id = p_org and role = 'admin') then
    raise exception 'an organization needs at least one admin' using errcode = 'P0001';
  end if;
end
$$;

create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform 1 from public.organizations where id = p_org for update;
  if not private.has_role(p_org, '{admin}') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.memberships where org_id = p_org and user_id = p_user;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.memberships where org_id = p_org and role = 'admin') then
    raise exception 'an organization needs at least one admin' using errcode = 'P0001';
  end if;
end
$$;

create or replace function public.leave_org(p_org uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_org public.organizations;
begin
  select * into v_org from public.organizations where id = p_org for update;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if v_org.is_demo then
    raise exception 'cannot leave the demo organization' using errcode = 'P0001';
  end if;
  delete from public.memberships where org_id = p_org and user_id = (select auth.uid());
  if not found then
    raise exception 'not a member' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.memberships where org_id = p_org and role = 'admin') then
    raise exception 'an organization needs at least one admin' using errcode = 'P0001';
  end if;
end
$$;

-- One statement marks the invitation accepted only if the token matches, it is open, unexpired
-- and addressed to the (confirmed) email of the caller; the membership is created in the same transaction.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_email text := lower(auth.jwt() ->> 'email'); v_inv public.invitations;
begin
  if v_uid is null or v_email is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null) then
    raise exception 'email not confirmed' using errcode = '42501';
  end if;
  update public.invitations
     set accepted_at = now()
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and accepted_at is null
     and expires_at > now()
     and lower(email) = v_email
  returning * into v_inv;
  if not found then
    raise exception 'invalid or expired invitation' using errcode = 'P0001';
  end if;
  insert into public.memberships (org_id, user_id, role) values (v_inv.org_id, v_uid, v_inv.role)
  on conflict (org_id, user_id) do nothing;
  return v_inv.org_id;
end
$$;

-- Platform administration. Every function re-checks the platform-admin flag.
create or replace function public.admin_create_org(
  p_name text, p_slug text, p_currency text, p_timezone text, p_admin_email text, p_token_hash text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, currency, timezone)
  values (p_name, p_slug, p_currency, p_timezone) returning id into v_org;
  insert into public.invitations (org_id, email, role, token_hash, invited_by)
  values (v_org, lower(p_admin_email), 'admin', p_token_hash, (select auth.uid()));
  return v_org;
end
$$;

create or replace function public.admin_set_modules(p_org uuid, p_modules text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.organizations set enabled_modules = p_modules where id = p_org;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
end
$$;

create or replace function public.admin_suspend_org(p_org uuid, p_suspend boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.organizations set suspended_at = case when p_suspend then now() else null end where id = p_org;
  if not found then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
end
$$;

create or replace function public.admin_list_orgs()
returns setof public.organizations
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from public.organizations order by created_at desc;
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'adjust_stock(uuid,integer,public.movement_reason,text)',
    'confirm_order(uuid)', 'cancel_order(uuid)', 'fulfill_order(uuid)',
    'change_member_role(uuid,uuid,public.member_role)', 'remove_member(uuid,uuid)', 'leave_org(uuid)',
    'accept_invitation(text)',
    'admin_create_org(text,text,text,text,text,text)', 'admin_set_modules(uuid,text[])',
    'admin_suspend_org(uuid,boolean)', 'admin_list_orgs()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;

-- ======================================================================================
-- Grants and RLS policies
-- ======================================================================================
alter table public.org_counters enable row level security;     -- no policies, no grants: definer only
alter table public.platform_admins enable row level security;  -- no policies, no grants: definer only
alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_log enable row level security;

-- profiles: own row plus people who share an organization with me
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
       where m.user_id = profiles.id and m.org_id in (select private.user_org_ids())
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- invitations: admins of the org manage them (accepting goes through accept_invitation)
grant select, insert, delete on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_role(org_id, '{admin}'));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (private.has_role(org_id, '{admin}'));
create policy invitations_delete on public.invitations for delete to authenticated
  using (private.has_role(org_id, '{admin}'));

-- customers (soft delete via active = false)
grant select, insert on public.customers to authenticated;
grant update (name, email, phone, active) on public.customers to authenticated;
create policy customers_select on public.customers for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy customers_insert on public.customers for insert to authenticated
  with check (private.has_role(org_id, '{admin,member}'));
create policy customers_update on public.customers for update to authenticated
  using (private.has_role(org_id, '{admin,member}'))
  with check (private.has_role(org_id, '{admin,member}'));

-- products (stock_qty changes only through adjust_stock / order functions)
grant select, insert, delete on public.products to authenticated;
grant update (sku, name, category_id, price, cost, reorder_level, active) on public.products to authenticated;
create policy products_select on public.products for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy products_insert on public.products for insert to authenticated
  with check (private.has_role(org_id, '{admin,member}'));
create policy products_update on public.products for update to authenticated
  using (private.has_role(org_id, '{admin,member}'))
  with check (private.has_role(org_id, '{admin,member}'));
create policy products_delete on public.products for delete to authenticated
  using (private.has_role(org_id, '{admin,member}'));

-- orders: editable only while draft; every status change goes through the order functions
grant select, insert on public.orders to authenticated;
grant update (customer_id, notes) on public.orders to authenticated;
create policy orders_select on public.orders for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy orders_insert on public.orders for insert to authenticated
  with check (private.has_role(org_id, '{admin,member}'));
create policy orders_update on public.orders for update to authenticated
  using (private.has_role(org_id, '{admin,member}') and status = 'draft')
  with check (private.has_role(org_id, '{admin,member}') and status = 'draft');

-- order_items: only while the parent order is a draft
grant select, insert, delete on public.order_items to authenticated;
grant update (product_id, qty, unit_price) on public.order_items to authenticated;
create policy order_items_select on public.order_items for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy order_items_insert on public.order_items for insert to authenticated
  with check (
    private.has_role(org_id, '{admin,member}')
    and exists (select 1 from public.orders o where o.id = order_items.order_id and o.org_id = order_items.org_id and o.status = 'draft')
  );
create policy order_items_update on public.order_items for update to authenticated
  using (
    private.has_role(org_id, '{admin,member}')
    and exists (select 1 from public.orders o where o.id = order_items.order_id and o.org_id = order_items.org_id and o.status = 'draft')
  )
  with check (
    private.has_role(org_id, '{admin,member}')
    and exists (select 1 from public.orders o where o.id = order_items.order_id and o.org_id = order_items.org_id and o.status = 'draft')
  );
create policy order_items_delete on public.order_items for delete to authenticated
  using (
    private.has_role(org_id, '{admin,member}')
    and exists (select 1 from public.orders o where o.id = order_items.order_id and o.org_id = order_items.org_id and o.status = 'draft')
  );

-- read-only for users
grant select on public.stock_movements to authenticated;
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (org_id in (select private.user_org_ids()));

grant select on public.audit_log to authenticated;
create policy audit_log_select on public.audit_log for select to authenticated
  using (private.has_role(org_id, '{admin}'));

-- products/customers/categories deletes and updates by id/org_id are never granted (column-level).
