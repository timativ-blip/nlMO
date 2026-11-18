create table public.budget_funds (
  id uuid primary key,
  kind text not null check (kind in ('district', 'media', 'direction')),
  district_id text references public.districts(id),
  responsible_id uuid references public.profiles(id),
  name text not null check (length(name) between 2 and 160),
  limit_minor bigint not null check (limit_minor between 0 and 100000000000),
  issued_minor bigint not null default 0 check (issued_minor >= 0 and issued_minor <= limit_minor),
  version integer not null default 1,
  check ((kind = 'district') = (district_id is not null)),
  check ((kind = 'direction') = (responsible_id is not null))
);
create unique index budget_funds_district on public.budget_funds(district_id) where kind = 'district';
create unique index budget_funds_media on public.budget_funds(kind) where kind = 'media';

create table public.budget_requests (
  id uuid primary key,
  fund_id uuid not null references public.budget_funds(id),
  recipient_id uuid not null references public.profiles(id),
  amount_minor integer not null check (amount_minor between 1 and 1000000000),
  purpose text not null check (length(purpose) between 3 and 300),
  status text not null default 'pending' check (status in ('pending', 'sent', 'rejected')),
  decision_note text not null default '' check (length(decision_note) <= 1000),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index budget_requests_fund on public.budget_requests(fund_id, created_at desc);
create index budget_requests_recipient on public.budget_requests(recipient_id, created_at desc);

create table public.budget_advances (
  id uuid primary key,
  fund_id uuid not null references public.budget_funds(id),
  request_id uuid unique references public.budget_requests(id),
  recipient_id uuid not null references public.profiles(id),
  issued_by uuid not null references public.profiles(id),
  district_id text references public.districts(id),
  purpose text not null check (length(purpose) between 3 and 300),
  amount_minor integer not null check (amount_minor between 1 and 1000000000),
  issued_on date not null,
  created_at timestamptz not null default now()
);
create index budget_advances_fund on public.budget_advances(fund_id, issued_on desc);
create index budget_advances_recipient on public.budget_advances(recipient_id, issued_on desc);

create table public.budget_expenses (
  id uuid primary key,
  advance_id uuid not null references public.budget_advances(id),
  spent_on date not null,
  description text not null check (length(description) between 3 and 1000),
  amount_minor integer not null check (amount_minor between 1 and 1000000000),
  receipt_path text not null unique,
  receipt_name text not null check (length(receipt_name) between 1 and 180),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'returned')),
  review_note text not null default '' check (length(review_note) <= 1000),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create index budget_expenses_advance on public.budget_expenses(advance_id, spent_on desc);

create function hq_private.budget_recipient_can_use(fund public.budget_funds, profile jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    profile->>'role' in ('head', 'staff', 'coordinator')
    and coalesce((profile->>'active')::boolean, true)
    and not coalesce((profile->>'pending')::boolean, false)
    and (profile->>'role' = 'head'
      or (fund.kind = 'district' and profile->>'role' = 'coordinator' and profile->>'districtId' = fund.district_id)
      or (fund.kind = 'media' and profile->>'title' = 'media')
      or (fund.kind = 'direction' and profile->>'id' = fund.responsible_id::text)),
    false)
$$;
revoke all on function hq_private.budget_recipient_can_use(public.budget_funds, jsonb) from public, anon, authenticated;

create function hq_private.budget_fund_read(fund public.budget_funds)
returns boolean language sql stable security definer set search_path = '' as $$
  select hq_private.active() and (
    hq_private.budget_recipient_can_use(fund, (select data from public.profiles where id = auth.uid()))
    or exists (select 1 from public.budget_advances where fund_id = fund.id and recipient_id = auth.uid())
    or exists (select 1 from public.budget_requests where fund_id = fund.id and recipient_id = auth.uid())
  )
$$;
revoke all on function hq_private.budget_fund_read(public.budget_funds) from public, anon, authenticated;
grant execute on function hq_private.budget_fund_read(public.budget_funds) to authenticated;

alter table public.budget_funds enable row level security;
alter table public.budget_requests enable row level security;
revoke all on public.budget_funds, public.budget_requests from public, anon, authenticated;
grant select on public.budget_funds, public.budget_requests to authenticated;
create policy budget_fund_read on public.budget_funds for select to authenticated
  using (hq_private.budget_fund_read(budget_funds));
create policy budget_request_read on public.budget_requests for select to authenticated
  using ((select hq_private.active()) and (recipient_id = (select auth.uid()) or (select public.my_role()) = 'head'));

alter table public.budget_advances enable row level security;
alter table public.budget_expenses enable row level security;
revoke all on public.budget_advances, public.budget_expenses from public, anon, authenticated;
grant select on public.budget_advances, public.budget_expenses to authenticated;
create policy budget_advance_read on public.budget_advances for select to authenticated
  using ((select hq_private.active()) and (recipient_id = (select auth.uid()) or (select public.my_role()) = 'head'));
create policy budget_expense_read on public.budget_expenses for select to authenticated
  using (exists (select 1 from public.budget_advances where id = advance_id));

create function hq_private.budget_receipt_access(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select hq_private.active() and (
    split_part(object_name, '/', 1) = auth.uid()::text
    or (public.my_role() = 'head' and exists (select 1 from public.budget_expenses where receipt_path = object_name))
  )
$$;
revoke all on function hq_private.budget_receipt_access(text) from public, anon, authenticated;
grant execute on function hq_private.budget_receipt_access(text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('budget-receipts', 'budget-receipts', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy budget_receipt_add on storage.objects for insert to authenticated with check (
  bucket_id = 'budget-receipts' and (select hq_private.active())
  and split_part(name, '/', 1) = (select auth.uid())::text
  and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(pdf|jpg|png|webp|heic|heif)$'
);
create policy budget_receipt_read on storage.objects for select to authenticated
  using (bucket_id = 'budget-receipts' and hq_private.budget_receipt_access(name));
create function hq_private.budget_action(action text, body jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  is_head boolean := public.my_role() = 'head';
  request_id uuid := (body->>'requestId')::uuid;
  item_id uuid := (body->>'id')::uuid;
  payload jsonb := jsonb_build_object('action', 'budget_' || action, 'body', body);
  previous hq_private.requests;
  fund public.budget_funds;
  funding_request public.budget_requests;
  advance public.budget_advances;
  expense public.budget_expenses;
  recipient uuid;
  district text;
  fund_kind text;
  responsible uuid;
  budget_limit bigint;
  amount integer;
  reason text;
  receipt text;
  note text;
  expense_date date;
  result jsonb;
begin
  if not hq_private.active() then raise exception 'Кабинет недоступен' using errcode = '42501'; end if;
  if request_id is null or item_id is null then raise exception 'Не указан номер записи'; end if;

  perform pg_advisory_xact_lock(hashtextextended(request_id::text, 0));
  select * into previous from hq_private.requests where id = request_id;
  if found then
    if previous.user_id <> actor or previous.body <> payload then raise exception 'Номер запроса уже использован'; end if;
    return previous.result;
  end if;

  if action = 'fund_save' then
    if not is_head then raise exception 'Бюджет настраивает руководство' using errcode = '42501'; end if;
    select * into fund from public.budget_funds where id = item_id for update;
    budget_limit := (body->>'limitMinor')::bigint;
    if budget_limit is null or budget_limit < coalesce(fund.issued_minor, 0) then
      raise exception 'Сумма бюджета не может быть меньше выданной суммы';
    end if;
    if fund.id is not null and fund.version is distinct from (body->>'version')::integer then
      raise exception 'Бюджет уже изменился. Обновите список.';
    end if;
    fund_kind := coalesce(fund.kind, body->>'kind');
    district := coalesce(fund.district_id, case when fund_kind = 'district' then nullif(body->>'districtId', '') end);
    responsible := case when fund_kind = 'direction' then (body->>'responsibleId')::uuid end;
    if fund_kind = 'direction' and not exists (select 1 from public.profiles where id = responsible
      and data->>'role' in ('head', 'staff', 'coordinator') and coalesce((data->>'active')::boolean, true)
      and not coalesce((data->>'pending')::boolean, false)) then
      raise exception 'Выберите действующего ответственного';
    end if;
    insert into public.budget_funds(id, kind, district_id, responsible_id, name, limit_minor)
    values (item_id, fund_kind, district, responsible, trim(body->>'name'), budget_limit)
    on conflict (id) do update set name = excluded.name, limit_minor = excluded.limit_minor,
      responsible_id = excluded.responsible_id, version = budget_funds.version + 1
    returning * into fund;
    result := to_jsonb(fund);
  elsif action = 'request' then
    select * into fund from public.budget_funds where id = (body->>'fundId')::uuid;
    if not found or not hq_private.budget_recipient_can_use(fund, (select data from public.profiles where id = actor)) then
      raise exception 'Этот бюджет недоступен для вашей заявки' using errcode = '42501';
    end if;
    insert into public.budget_requests(id, fund_id, recipient_id, amount_minor, purpose)
    values (item_id, fund.id, actor, (body->>'amountMinor')::integer, trim(body->>'purpose'))
    returning * into funding_request;
    result := to_jsonb(funding_request);
  elsif action in ('issue', 'mark_sent', 'reject') then
    if not is_head then raise exception 'Выдачу регистрирует руководство' using errcode = '42501'; end if;
    if action <> 'issue' then
      select * into funding_request from public.budget_requests where id = item_id for update;
      if not found or funding_request.status <> 'pending' then
        raise exception 'По заявке уже принято решение. Обновите список.';
      end if;
    end if;

    note := trim(coalesce(body->>'note', ''));
    if action = 'reject' then
      if length(note) < 3 then raise exception 'Укажите причину отказа'; end if;
      update public.budget_requests set status = 'rejected', decision_note = note, decided_at = now()
      where id = item_id returning * into funding_request;
      result := to_jsonb(funding_request);
    else
      select * into fund from public.budget_funds
        where id = coalesce(funding_request.fund_id, (body->>'fundId')::uuid) for update;
      if not found then raise exception 'Бюджет не найден'; end if;
      recipient := coalesce(funding_request.recipient_id, (body->>'recipientId')::uuid);
      if not hq_private.budget_recipient_can_use(fund, (select data from public.profiles where id = recipient)) then
        raise exception 'Получатель не относится к этому бюджету';
      end if;
      amount := coalesce(funding_request.amount_minor, (body->>'amountMinor')::integer);
      reason := coalesce(funding_request.purpose, trim(body->>'purpose'));
      expense_date := (body->>'date')::date;
      if expense_date is null or not isfinite(expense_date) or expense_date > public.msk_today()::date then
        raise exception 'Проверьте дату отправки денег';
      end if;
      if amount is null or amount < 1 or amount > fund.limit_minor - fund.issued_minor then
        raise exception 'В бюджете недостаточно средств. Увеличьте бюджет перед отметкой отправки.';
      end if;
      insert into public.budget_advances(id, fund_id, request_id, recipient_id, issued_by, district_id, purpose, amount_minor, issued_on)
      values (item_id, fund.id, funding_request.id, recipient, actor, fund.district_id, reason, amount, expense_date)
      returning * into advance;
      update public.budget_funds set issued_minor = issued_minor + amount, version = version + 1 where id = fund.id;
      if action = 'mark_sent' then
        update public.budget_requests set status = 'sent', decision_note = note, decided_at = now() where id = item_id;
      end if;
      result := to_jsonb(advance);
    end if;
  elsif action = 'submit' then
    select * into advance from public.budget_advances where id = (body->>'advanceId')::uuid;
    if not found or advance.recipient_id <> actor then
      raise exception 'Расход добавляет получатель средств' using errcode = '42501';
    end if;
    select * into expense from public.budget_expenses where id = item_id for update;
    if found and (expense.advance_id <> advance.id or expense.status <> 'returned'
        or expense.version is distinct from (body->>'version')::integer) then
      raise exception 'Расход уже изменился. Обновите список.';
    end if;
    expense_date := (body->>'date')::date;
    if expense_date is null or not isfinite(expense_date) or expense_date > public.msk_today()::date then
      raise exception 'Проверьте дату расхода';
    end if;
    receipt := body->>'receiptPath';
    if receipt is null or split_part(receipt, '/', 1) <> actor::text or split_part(receipt, '/', 2) <> item_id::text
      or not exists (select 1 from storage.objects where bucket_id = 'budget-receipts' and name = receipt for share) then
      raise exception 'Прикрепите чек к этому расходу';
    end if;
    if expense.id is null then
      insert into public.budget_expenses(id, advance_id, spent_on, description, amount_minor, receipt_path, receipt_name)
      values (item_id, advance.id, expense_date, trim(body->>'description'), (body->>'amountMinor')::integer, receipt, body->>'receiptName')
      returning * into expense;
    else
      update public.budget_expenses set spent_on = expense_date, description = trim(body->>'description'),
        amount_minor = (body->>'amountMinor')::integer, receipt_path = receipt, receipt_name = body->>'receiptName',
        status = 'pending', review_note = '', reviewed_by = null, reviewed_at = null,
        version = version + 1, updated_at = now()
      where id = item_id returning * into expense;
    end if;
    result := to_jsonb(expense);
  elsif action = 'review' then
    if not is_head then raise exception 'Расходы проверяет руководитель' using errcode = '42501'; end if;
    select * into expense from public.budget_expenses where id = item_id for update;
    if not found or expense.status <> 'pending' or expense.version is distinct from (body->>'version')::integer then
      raise exception 'Расход уже проверен или изменён. Обновите список.';
    end if;
    note := trim(coalesce(body->>'note', ''));
    if coalesce(body->>'status', '') not in ('accepted', 'returned') or (body->>'status' = 'returned' and length(note) < 3) then
      raise exception 'Укажите решение и причину возврата';
    end if;
    update public.budget_expenses set status = body->>'status', review_note = note, reviewed_at = now(),
      reviewed_by = actor, version = version + 1, updated_at = now()
    where id = item_id returning * into expense;
    result := to_jsonb(expense);
  else
    raise exception 'Неизвестное действие';
  end if;

  insert into hq_private.requests(id, user_id, body, result) values (request_id, actor, payload, result);
  return result;
end $$;

revoke all on function hq_private.budget_action(text, jsonb) from public, anon, authenticated;
grant execute on function hq_private.budget_action(text, jsonb) to authenticated;
create function public.budget(p_action text, p_body jsonb) returns jsonb
language sql security invoker set search_path = '' as $$select hq_private.budget_action(p_action, p_body)$$;
revoke all on function public.budget(text, jsonb) from public, anon, authenticated;
grant execute on function public.budget(text, jsonb) to authenticated;

-- Every district and Media gets an editable zero balance. No amounts are assumed.
create function hq_private.seed_district_budget()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.budget_funds(id, kind, district_id, name, limit_minor)
  values (gen_random_uuid(), 'district', new.id, left(coalesce(nullif(trim(new.data->>'name'), ''), 'Округ ' || new.id), 160), 0)
  on conflict do nothing;
  return new;
end $$;
revoke all on function hq_private.seed_district_budget() from public, anon, authenticated;
create trigger budget_for_new_district after insert on public.districts
for each row execute function hq_private.seed_district_budget();

insert into public.budget_funds(id, kind, district_id, name, limit_minor)
select gen_random_uuid(), 'district', d.id, left(coalesce(nullif(trim(d.data->>'name'), ''), 'Округ ' || d.id), 160), 0
from public.districts d on conflict do nothing;
insert into public.budget_funds(id, kind, name, limit_minor) values (gen_random_uuid(), 'media', 'Медиа', 0)
on conflict do nothing;
