-- Сводка миграций team_roles, developer_role, self_registration, deputy_coordinator_daily_reports
-- (применены в Supabase через MCP 27.10.2026; здесь — итоговое состояние).

-- Роль в команде (title) поверх уровня доступа (role). Руководство (head) меняет всё;
-- координатор и его заместитель — только участников своего округа (участник ↔ член партии, доступ, заявки).
create or replace function profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := old.data; n jsonb := new.data;
  admin_changed boolean := (n->'role', n->'title', n->'districtId', n->'active', n->'pending') is distinct from (o->'role', o->'title', o->'districtId', o->'active', o->'pending');
begin
  if auth.uid() is null then return new; end if;
  new.data := jsonb_set(new.data, '{id}', to_jsonb(old.id::text));
  if admin_changed and not is_head() then
    if not (is_coord_of(o->>'districtId') and old.id <> auth.uid()
            and o->>'role' = 'member' and n->>'role' = 'member'
            and n->>'districtId' is not distinct from o->>'districtId'
            and coalesce(n->>'title', 'member') in ('member', 'party_member')) then
      raise exception 'Роль и доступ меняют руководство области, а для участников своего округа — координатор или его заместитель';
    end if;
  end if;
  if n->>'title' is not null and n->>'title' not in ('head', 'developer', 'deputy', 'coordinator', 'deputy_coordinator', 'staff', 'media', 'member', 'party_member') then
    raise exception 'Неизвестная роль в команде';
  end if;
  if length(trim(coalesce(n->>'name', ''))) < 3 then raise exception 'Укажите имя и фамилию'; end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.profiles_guard() from public, anon, authenticated;

-- Тимур Василевский — разработчик с правами руководителя
update profiles set data = data || '{"title":"developer","role":"head"}'::jsonb
where data->>'name' ilike '%Василевский%Тимур%' or data->>'name' ilike '%Тимур%Василевский%';

drop policy if exists p_update on profiles;
create policy p_update on profiles for update to authenticated
  using (id = auth.uid() or is_head() or is_coord_of(data->>'districtId'))
  with check (id = auth.uid() or is_head() or is_coord_of(data->>'districtId'));

-- Статус своей учётной записи: нужен человеку, чья заявка ещё не одобрена (он не видит профили по RLS)
create or replace function my_status() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('exists', true, 'active', coalesce((data->>'active')::boolean, true), 'pending', coalesce((data->>'pending')::boolean, false),
    'name', data->>'name', 'title', data->>'title', 'districtId', data->>'districtId') from profiles where id = auth.uid()), '{"exists": false}'::jsonb)
$$;
revoke execute on function public.my_status() from public, anon;
grant execute on function public.my_status() to authenticated;

-- Ежедневные отчёты о работе
create table daily_reports (
  id text primary key,
  user_id uuid not null default auth.uid() references profiles on delete cascade,
  day text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);
create index on daily_reports (day);
alter table daily_reports enable row level security;

create or replace function author_district(uid uuid) returns text language sql stable security definer set search_path = public as
$$ select data->>'districtId' from profiles where id = uid $$;
revoke execute on function public.author_district(uuid) from public, anon;
grant execute on function public.author_district(uuid) to authenticated;

create policy dr_read on daily_reports for select to authenticated using (
  user_id = auth.uid() or is_head() or (my_role() = 'coordinator' and author_district(user_id) = my_district()));
create policy dr_insert on daily_reports for insert to authenticated with check (user_id = auth.uid() and my_role() is not null);
create policy dr_update on daily_reports for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function daily_reports_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  new.user_id := auth.uid();
  new.day := coalesce(new.data->>'day', msk_today());
  if new.day > msk_today() then raise exception 'Нельзя заполнить отчёт за будущий день'; end if;
  if tg_op = 'UPDATE' and old.day < to_char((now() at time zone 'Europe/Moscow')::date - 2, 'YYYY-MM-DD') then
    raise exception 'Отчёт старше двух дней закрыт для изменений';
  end if;
  if length(trim(coalesce(new.data->>'done', ''))) < 10 then raise exception 'Опишите, что сделано за день — хотя бы одно предложение'; end if;
  new.data := new.data || jsonb_build_object('id', new.id, 'userId', auth.uid()::text, 'day', new.day, 'updatedAt', now());
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.daily_reports_guard() from public, anon, authenticated;
create trigger daily_reports_guard before insert or update on daily_reports for each row execute function daily_reports_guard();
create trigger audit after insert or update on daily_reports for each row execute function write_audit();
alter publication supabase_realtime add table daily_reports;

-- Напоминание в 18:00 МСК по будням тем, кто должен сдать отчёт и ещё не сдал
create or replace function daily_report_reminders() returns void language plpgsql security definer set search_path = public as $$
declare today text := msk_today();
begin
  insert into notifications (id, user_id, data)
  select 'dr_' || p.id::text || '_' || today, p.id,
         jsonb_build_object('id', 'dr_' || p.id::text || '_' || today, 'userId', p.id::text,
           'text', 'Напоминание: заполните отчёт о работе за сегодня — это займёт пару минут', 'at', now(), 'read', false,
           'link', '#/daily', 'kind', 'report')
  from profiles p
  where coalesce((p.data->>'active')::boolean, true)
    and coalesce(p.data->>'title', p.data->>'role') in ('staff', 'media', 'coordinator', 'deputy_coordinator', 'deputy')
    and not exists (select 1 from daily_reports r where r.user_id = p.id and r.day = today)
  on conflict (id) do nothing;
end $$;
revoke execute on function public.daily_report_reminders() from public, anon, authenticated;
select cron.schedule('daily-report-reminders', '0 15 * * 1-5', 'select public.daily_report_reminders()');
