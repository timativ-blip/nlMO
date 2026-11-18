alter table public.hq_resources
  add column size text not null default '' check (length(size) <= 80),
  add column color text not null default '' check (length(color) <= 80),
  add column quantity integer not null default 1 check (quantity between 1 and 100000),
  add constraint room_inventory_quantity check (kind <> 'room' or quantity = 1);

alter table public.hq_reservations
  add column quantity integer not null default 1 check (quantity between 1 and 100000);

-- Called with the resource row locked. Issued items remain occupied until returned.
create function hq_private.inventory_peak(
  resource_id uuid, from_time timestamptz, to_time timestamptz, exclude_id uuid
) returns bigint language sql stable set search_path = '' as $$
  with reservations as (
    select b.quantity, greatest(b.starts_at, from_time) as starts_at, least(b.ends_at, to_time) as ends_at
    from public.hq_reservations b
    where b.resource_id = inventory_peak.resource_id
      and b.id is distinct from exclude_id
      and b.status = 'reserved' and b.starts_at < to_time and b.ends_at > from_time
  ), changes as (
    select starts_at as at, quantity as delta from reservations
    union all select ends_at, -quantity from reservations
  ), balances as (
    select sum(sum(delta)) over (order by at) as occupied from changes group by at
  )
  select coalesce((select max(occupied) from balances), 0)::bigint
    + coalesce((select sum(b.quantity) from public.hq_reservations b
      where b.resource_id = inventory_peak.resource_id and b.status = 'issued'
        and b.id is distinct from exclude_id), 0)
$$;

create function hq_private.inventory_action(action text, body jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  manager boolean := hq_private.manager();
  request_id uuid := (body->>'requestId')::uuid;
  item_id uuid := coalesce(nullif(body->>'id', '')::uuid, gen_random_uuid());
  request jsonb := jsonb_build_object('action', action, 'body', body);
  previous hq_private.requests;
  resource public.hq_resources;
  booking public.hq_reservations;
  start_time timestamptz;
  end_time timestamptz;
  amount integer;
  recipient uuid;
  result jsonb;
begin
  if not hq_private.active() then raise exception 'Кабинет недоступен' using errcode = '42501'; end if;
  if request_id is null then raise exception 'Нет номера запроса'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_id::text, 0));
  select * into previous from hq_private.requests where id = request_id;
  if found then
    if previous.user_id <> actor or previous.body <> request then raise exception 'Номер запроса уже использован'; end if;
    return previous.result;
  end if;

  if action = 'resource_save' then
    if not manager then raise exception 'Каталог ведёт штаб' using errcode = '42501'; end if;
    if coalesce(body->>'kind', '') not in ('room', 'equipment') then raise exception 'Выберите тип ресурса'; end if;
    if length(coalesce(body->>'description', '')) > 2000 or length(coalesce(body->>'code', '')) > 80
      or length(coalesce(body->>'size', '')) > 80 or length(coalesce(body->>'color', '')) > 80 then
      raise exception 'Сократите описание или характеристики';
    end if;

    select * into resource from public.hq_resources where id = item_id for update;
    if found and resource.kind <> body->>'kind' then raise exception 'Тип существующего ресурса менять нельзя'; end if;
    amount := case when body->>'kind' = 'room' then 1 else coalesce((body->>'quantity')::integer, resource.quantity, 1) end;
    if amount not between 1 and 100000 then raise exception 'Укажите целое количество от 1 до 100 000'; end if;
    if resource.id is not null and amount < resource.quantity
      and amount < hq_private.inventory_peak(item_id, now(), 'infinity', null) then
      raise exception 'Часть инвентаря уже забронирована или выдана. Укажите большее количество.';
    end if;

    insert into public.hq_resources(id, kind, name, code, description, active, created_by, size, color, quantity)
    values (item_id, body->>'kind', trim(body->>'name'), coalesce(body->>'code', ''),
      coalesce(body->>'description', ''), coalesce((body->>'active')::boolean, true), actor,
      case when body->>'kind' = 'equipment' then trim(coalesce(body->>'size', resource.size, '')) else '' end,
      case when body->>'kind' = 'equipment' then trim(coalesce(body->>'color', resource.color, '')) else '' end,
      amount)
    on conflict (id) do update set name = excluded.name, code = excluded.code,
      description = excluded.description, active = excluded.active, size = excluded.size,
      color = excluded.color, quantity = excluded.quantity
    returning * into resource;
    result := to_jsonb(resource);
  elsif action = 'reserve' then
    select * into resource from public.hq_resources where id = (body->>'resourceId')::uuid for update;
    if not found or not resource.active then raise exception 'Ресурс недоступен для брони'; end if;
    start_time := (body->>'startsAt')::timestamptz;
    end_time := (body->>'endsAt')::timestamptz;
    if start_time is null or end_time is null or not isfinite(start_time) or not isfinite(end_time)
      or start_time < now() - interval '5 minutes' or start_time > now() + interval '1 year'
      or end_time <= start_time or end_time > start_time + interval '90 days' then
      raise exception 'Проверьте начало и окончание брони (до 90 дней)';
    end if;

    amount := case when resource.kind = 'room' then 1 else coalesce((body->>'quantity')::integer, 1) end;
    if amount not between 1 and resource.quantity then raise exception 'Укажите количество в пределах остатка'; end if;
    if amount + hq_private.inventory_peak(resource.id, start_time, end_time, null) > resource.quantity then
      if exists(select 1 from public.hq_reservations where resource_id = resource.id and status = 'issued') then
        raise exception 'Часть оборудования ещё не возвращено. Измените количество или время.';
      end if;
      raise exception 'На это время уже есть бронь и в наличии недостаточно единиц. Измените количество или время.';
    end if;

    insert into public.hq_reservations(id, resource_id, borrower_id, district_id, purpose, starts_at, ends_at, updated_by, quantity)
    values (item_id, resource.id, actor, (select nullif(data->>'districtId', '') from public.profiles where id = actor),
      trim(body->>'purpose'), start_time, end_time, actor, amount) returning * into booking;
    for recipient in select id from public.profiles where data->>'role' in ('head', 'staff') and id <> actor loop
      perform hq_private.notify(recipient, 'hq_booking_'||item_id||'_'||recipient,
        'Новая бронь: '||resource.name||case when resource.kind = 'equipment' then ' · '||amount||' шт.' else '' end||
        ' · '||to_char(start_time at time zone 'Europe/Moscow', 'DD.MM HH24:MI')||' МСК',
        '#/'||case when resource.kind = 'room' then 'headquarters' else 'equipment' end);
    end loop;
    result := to_jsonb(booking);
  elsif action = 'reservation_update' then
    select r.* into resource from public.hq_resources r join public.hq_reservations b on b.resource_id = r.id
      where b.id = item_id for update of r;
    select * into booking from public.hq_reservations where id = item_id for update;
    if booking.id is null or not (manager or booking.borrower_id = actor) then
      raise exception 'Нет доступа к брони' using errcode = '42501';
    end if;
    if booking.version is distinct from (body->>'version')::integer then
      raise exception 'Бронь уже изменилась. Обновите список.';
    end if;

    if body->>'status' = 'cancelled' and booking.status = 'reserved' then
      booking.status := 'cancelled';
    elsif body->>'status' = 'issued' and booking.status = 'reserved' and resource.kind = 'equipment' then
      if not resource.active or booking.starts_at > now() + interval '30 minutes' or booking.ends_at <= now() then
        raise exception 'Получение доступно с 30 минут до начала и до окончания брони';
      end if;
      if booking.quantity + hq_private.inventory_peak(resource.id, now(), booking.ends_at, booking.id) > resource.quantity then
        raise exception 'Оборудование ещё у другого сотрудника или на это время действует его бронь';
      end if;
      booking.status := 'issued';
      booking.issued_at := now();
      booking.issue_note := coalesce(body->>'note', '');
    elsif body->>'status' = 'returned' and booking.status = 'issued' and resource.kind = 'equipment' then
      booking.status := 'returned';
      booking.returned_at := now();
      booking.return_note := coalesce(body->>'note', '');
    else
      raise exception 'Это действие недоступно для текущего состояния брони';
    end if;
    if length(booking.issue_note) > 2000 or length(booking.return_note) > 2000 then
      raise exception 'Комментарий — до 2000 символов';
    end if;

    update public.hq_reservations set status = booking.status, issued_at = booking.issued_at,
      returned_at = booking.returned_at, issue_note = booking.issue_note, return_note = booking.return_note,
      updated_by = actor, version = version + 1 where id = item_id returning * into booking;
    for recipient in select id from public.profiles
      where (data->>'role' in ('head', 'staff') or id = booking.borrower_id) and id <> actor loop
      perform hq_private.notify(recipient, 'hq_booking_'||item_id||'_v'||booking.version||'_'||recipient,
        resource.name||': '||case booking.status when 'issued' then 'получено сотрудником'
          when 'returned' then 'возвращено' else 'бронь отменена' end,
        '#/'||case when resource.kind = 'room' then 'headquarters' else 'equipment' end);
    end loop;
    result := to_jsonb(booking);
  else
    raise exception 'Неизвестное действие';
  end if;

  insert into hq_private.requests(id, user_id, body, result) values (request_id, actor, request, result);
  return result;
end $$;

revoke all on function hq_private.inventory_peak(uuid, timestamptz, timestamptz, uuid),
  hq_private.inventory_action(text, jsonb) from public, anon, authenticated;
grant execute on function hq_private.inventory_action(text, jsonb) to authenticated;

revoke execute on function hq_private.dispatch(text, jsonb) from authenticated;
create function hq_private.route(p_action text, p_body jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select case when p_action in ('resource_save', 'reserve', 'reservation_update')
    then hq_private.inventory_action(p_action, p_body)
    else hq_private.dispatch(p_action, p_body)
  end
$$;

revoke all on function hq_private.route(text, jsonb) from public, anon, authenticated;
grant execute on function hq_private.route(text, jsonb) to authenticated;

create or replace function public.headquarters(p_action text, p_body jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$
  select hq_private.route(p_action, p_body)
$$;
