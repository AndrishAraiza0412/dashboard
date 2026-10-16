-- Purchases (supplier orders): same model as sales orders in 0004.
-- Stock only goes up when the goods are received, through receive_purchase_order.

-- audit trail
do $$
declare t text;
begin
  foreach t in array array['suppliers','purchase_orders','purchase_order_items']
  loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit()', t);
  end loop;
end
$$;

-- purchase_orders.total is derived from the lines
create or replace function private.recalc_purchase_total()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders
     set total = coalesce((select round(sum(line_total), 2) from public.purchase_order_items where purchase_order_id = v_po), 0)
   where id = v_po;
  return null;
end
$$;
drop trigger if exists recalc_total on public.purchase_order_items;
create trigger recalc_total after insert or update or delete on public.purchase_order_items
  for each row execute function private.recalc_purchase_total();

create or replace function private.force_purchase_defaults()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.number := null; new.status := 'draft'; new.total := 0; new.ordered_at := null; new.received_at := null;
  end if;
  return new;
end $$;
drop trigger if exists force_defaults on public.purchase_orders;
create trigger force_defaults before insert on public.purchase_orders
  for each row execute function private.force_purchase_defaults();

revoke execute on function private.recalc_purchase_total() from public, anon, authenticated;
revoke execute on function private.force_purchase_defaults() from public, anon, authenticated;

-- draft -> ordered: needs a supplier and at least one line; takes the next purchase number
create or replace function public.place_purchase_order(p_po uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_po public.purchase_orders; v_number integer;
begin
  select * into v_po from public.purchase_orders where id = p_po for update;
  if not found then
    raise exception 'purchase order not found' using errcode = 'P0002';
  end if;
  if not private.has_role(v_po.org_id, '{admin,member}') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_po.status <> 'draft' then
    raise exception 'purchase order is not a draft' using errcode = 'P0001';
  end if;
  if v_po.supplier_id is null then
    raise exception 'purchase order has no supplier' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.purchase_order_items where purchase_order_id = p_po) then
    raise exception 'purchase order has no items' using errcode = 'P0001';
  end if;

  insert into public.org_counters (org_id, next_purchase_no) values (v_po.org_id, 2)
  on conflict (org_id) do update set next_purchase_no = org_counters.next_purchase_no + 1
  returning next_purchase_no - 1 into v_number;

  update public.purchase_orders set status = 'ordered', number = v_number, ordered_at = now() where id = p_po;
  return v_number;
end
$$;

-- ordered -> received: every line adds its quantity to stock
create or replace function public.receive_purchase_order(p_po uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_po public.purchase_orders; v_item record;
begin
  select * into v_po from public.purchase_orders where id = p_po for update;
  if not found then
    raise exception 'purchase order not found' using errcode = 'P0002';
  end if;
  if not private.has_role(v_po.org_id, '{admin,member}') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_po.status <> 'ordered' then
    raise exception 'only ordered purchase orders can be received' using errcode = 'P0001';
  end if;

  -- same lock order as the sales functions (by product id) to avoid deadlocks
  perform 1 from public.products p
   where p.id in (select product_id from public.purchase_order_items where purchase_order_id = p_po)
   order by p.id for update;
  for v_item in
    select product_id, qty from public.purchase_order_items where purchase_order_id = p_po order by product_id
  loop
    update public.products set stock_qty = stock_qty + v_item.qty where id = v_item.product_id;
    insert into public.stock_movements (org_id, product_id, delta, reason, purchase_order_id)
    values (v_po.org_id, v_item.product_id, v_item.qty, 'purchase', p_po);
  end loop;

  update public.purchase_orders set status = 'received', received_at = now() where id = p_po;
end
$$;

-- draft/ordered -> cancelled (nothing was received, so stock is untouched)
create or replace function public.cancel_purchase_order(p_po uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_po public.purchase_orders;
begin
  select * into v_po from public.purchase_orders where id = p_po for update;
  if not found then
    raise exception 'purchase order not found' using errcode = 'P0002';
  end if;
  if not private.has_role(v_po.org_id, '{admin,member}') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_po.status not in ('draft', 'ordered') then
    raise exception 'purchase order cannot be cancelled' using errcode = 'P0001';
  end if;
  update public.purchase_orders set status = 'cancelled' where id = p_po;
end
$$;

do $$
declare f text;
begin
  foreach f in array array['place_purchase_order(uuid)', 'receive_purchase_order(uuid)', 'cancel_purchase_order(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;

-- RLS
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

-- suppliers (soft delete via active = false)
grant select, insert on public.suppliers to authenticated;
grant update (name, email, phone, active) on public.suppliers to authenticated;
create policy suppliers_select on public.suppliers for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (private.has_role(org_id, '{admin,member}'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (private.has_role(org_id, '{admin,member}'))
  with check (private.has_role(org_id, '{admin,member}'));

-- purchase_orders: editable only while draft; status changes go through the functions above
grant select, insert on public.purchase_orders to authenticated;
grant update (supplier_id, notes) on public.purchase_orders to authenticated;
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated
  with check (private.has_role(org_id, '{admin,member}'));
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using (private.has_role(org_id, '{admin,member}') and status = 'draft')
  with check (private.has_role(org_id, '{admin,member}') and status = 'draft');

-- purchase_order_items: only while the parent purchase order is a draft
grant select, insert, delete on public.purchase_order_items to authenticated;
grant update (product_id, qty, unit_cost) on public.purchase_order_items to authenticated;
create policy purchase_order_items_select on public.purchase_order_items for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy purchase_order_items_insert on public.purchase_order_items for insert to authenticated
  with check (
    private.has_role(org_id, '{admin,member}')
    and exists (select 1 from public.purchase_orders o where o.id = purchase_order_items.purchase_order_id and o.org_id = purchase_order_items.org_id and o.status = 'draft')
  );
create policy purchase_order_items_update on public.purchase_order_items for update to authenticated
  using (
    private.has_role(org_id, '{admin,member}')
    and exists (select 1 from public.purchase_orders o where o.id = purchase_order_items.purchase_order_id and o.org_id = purchase_order_items.org_id and o.status = 'draft')
  )
  with check (
    private.has_role(org_id, '{admin,member}')
    and exists (select 1 from public.purchase_orders o where o.id = purchase_order_items.purchase_order_id and o.org_id = purchase_order_items.org_id and o.status = 'draft')
  );
create policy purchase_order_items_delete on public.purchase_order_items for delete to authenticated
  using (
    private.has_role(org_id, '{admin,member}')
    and exists (select 1 from public.purchase_orders o where o.id = purchase_order_items.purchase_order_id and o.org_id = purchase_order_items.org_id and o.status = 'draft')
  );
