-- Командный центр | Московская область — рабочая схема Supabase.
-- Сущности хранятся документами (jsonb в том же виде, что в src/data/types.ts),
-- а права и бизнес-правила проверяются на сервере: RLS + триггеры. Клиенту сервер не доверяет.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

/* ───────── Таблицы ───────── */
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table districts (id text primary key, data jsonb not null);
create table metrics (id text primary key, data jsonb not null);
create table settings (key text primary key, value jsonb not null);
create table tasks (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table events (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table reports (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table notifications (
  id text primary key,
  user_id uuid not null references profiles on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  entity text not null,
  entity_id text not null,
  action text not null,
  old_data jsonb,
  new_data jsonb
);
create index on audit_log (at desc);
create table telegram_links (user_id uuid primary key references profiles on delete cascade, chat_id bigint not null, linked_at timestamptz not null default now());
create table telegram_link_codes (code text primary key, user_id uuid not null references profiles on delete cascade, created_at timestamptz not null default now());
create table app_secrets (key text primary key, value text not null);
insert into app_secrets values ('hook_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

/* ───────── Кто я ───────── */
create or replace function my_role() returns text language sql stable security definer set search_path = public as
$$ select data->>'role' from profiles where id = auth.uid() and coalesce((data->>'active')::boolean, true) $$;
create or replace function my_district() returns text language sql stable security definer set search_path = public as
$$ select data->>'districtId' from profiles where id = auth.uid() $$;
create or replace function is_manager() returns boolean language sql stable as $$ select coalesce(my_role() in ('head', 'staff'), false) $$;
create or replace function is_head() returns boolean language sql stable as $$ select coalesce(my_role() = 'head', false) $$;
create or replace function is_coord_of(d text) returns boolean language sql stable as $$ select coalesce(my_role() = 'coordinator' and my_district() = d, false) $$;
create or replace function can_assign(d text) returns boolean language sql stable as $$ select is_manager() or is_coord_of(d) $$;
create or replace function msk_today() returns text language sql stable as $$ select to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD') $$;

-- Доступно до входа: нужен ли первый запуск
create or replace function is_initialized() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles) $$;
grant execute on function is_initialized() to anon, authenticated;

/* ───────── RLS ───────── */
alter table profiles enable row level security;
alter table districts enable row level security;
alter table metrics enable row level security;
alter table settings enable row level security;
alter table tasks enable row level security;
alter table events enable row level security;
alter table reports enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;
alter table telegram_links enable row level security;
alter table telegram_link_codes enable row level security;
alter table app_secrets enable row level security; -- без политик: только сервисная роль
revoke all on app_secrets from anon, authenticated;

create policy p_read on profiles for select to authenticated using (my_role() is not null);
create policy p_update on profiles for update to authenticated using (id = auth.uid() or is_head()) with check (id = auth.uid() or is_head());

create policy d_read on districts for select to authenticated using (my_role() is not null);
create policy d_write on districts for all to authenticated using (is_head()) with check (is_head());
create policy m_read on metrics for select to authenticated using (my_role() is not null);
create policy m_write on metrics for all to authenticated using (is_head()) with check (is_head());
create policy s_read on settings for select to authenticated using (my_role() is not null);
create policy s_write on settings for all to authenticated using (is_head()) with check (is_head());

create policy t_read on tasks for select to authenticated using (
  is_manager() or is_coord_of(data->>'districtId')
  or data->>'assigneeId' = auth.uid()::text or data->>'authorId' = auth.uid()::text
  or (data->'coAssigneeIds') ? auth.uid()::text);
create policy t_insert on tasks for insert to authenticated with check (can_assign(data->>'districtId'));
create policy t_update on tasks for update to authenticated using (
  is_manager() or is_coord_of(data->>'districtId')
  or data->>'assigneeId' = auth.uid()::text or data->>'authorId' = auth.uid()::text
  or (data->'coAssigneeIds') ? auth.uid()::text);

create policy e_read on events for select to authenticated using (
  is_manager() or data->>'ownerId' = auth.uid()::text or (data->'participantIds') ? auth.uid()::text
  or (data->>'districtId' is not null and data->>'districtId' = my_district())
  or (data->>'districtId' is null and my_role() in ('coordinator')));
create policy e_insert on events for insert to authenticated with check (
  is_manager() or (my_role() = 'coordinator' and data->>'districtId' = my_district()));
create policy e_update on events for update to authenticated using (
  is_manager() or data->>'ownerId' = auth.uid()::text or is_coord_of(data->>'districtId'))
  with check (is_manager() or data->>'ownerId' = auth.uid()::text or is_coord_of(data->>'districtId'));

create policy r_read on reports for select to authenticated using (
  is_manager() or is_coord_of(data->>'districtId') or (data->>'districtId' = my_district() and data->>'status' = 'accepted'));
create policy r_insert on reports for insert to authenticated with check (is_head() or is_coord_of(data->>'districtId'));
create policy r_update on reports for update to authenticated using (is_head() or is_coord_of(data->>'districtId'));

create policy n_read on notifications for select to authenticated using (user_id = auth.uid());
create policy n_update on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy n_insert on notifications for insert to authenticated with check (my_role() is not null);

create policy a_read on audit_log for select to authenticated using (is_head());
create policy tl_read on telegram_links for select to authenticated using (user_id = auth.uid());
create policy tl_delete on telegram_links for delete to authenticated using (user_id = auth.uid());
create policy tc_insert on telegram_link_codes for insert to authenticated with check (user_id = auth.uid());

/* ───────── Профили ───────── */
create or replace function profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  new.data := jsonb_set(new.data, '{id}', to_jsonb(old.id::text));
  if not is_head() and (new.data->'role', new.data->'districtId', new.data->'active') is distinct from (old.data->'role', old.data->'districtId', old.data->'active') then
    raise exception 'Роль, округ и активность меняет руководитель области';
  end if;
  if length(trim(coalesce(new.data->>'name', ''))) < 3 then raise exception 'Укажите имя и фамилию'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_guard before update on profiles for each row execute function profiles_guard();

/* ───────── Задачи: создание ───────── */
create or replace function tasks_insert_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if not can_assign(new.data->>'districtId') then raise exception 'Вы можете ставить задачи только в своём округе'; end if;
  if length(trim(coalesce(new.data->>'title', ''))) < 3 then raise exception 'Введите название задачи — хотя бы 3 символа'; end if;
  if not exists (select 1 from profiles where id::text = new.data->>'assigneeId') then raise exception 'Ответственный не найден'; end if;
  new.data := new.data || jsonb_build_object('id', new.id, 'authorId', auth.uid()::text, 'status', 'new', 'createdAt', now(),
    'result', null, 'confirmedAt', null, 'confirmedBy', null, 'returnedAt', null);
  return new;
end $$;
create trigger tasks_insert_guard before insert on tasks for each row execute function tasks_insert_guard();

/* ───────── Задачи: изменения и переходы статусов ───────── */
create or replace function tasks_update_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  u text := auth.uid()::text;
  r text := my_role();
  o jsonb := old.data;
  n jsonb := new.data;
  cr jsonb := new.data->'result';
  s0 text := old.data->>'status';
  s1 text := new.data->>'status';
  free_keys text[] := array['comments', 'checklist', 'attachments', 'history', 'status', 'result', 'returnedAt', 'confirmedAt', 'confirmedBy'];
  sys_keys text[] := array['id', 'authorId', 'createdAt', 'confirmedAt', 'confirmedBy', 'returnedAt', 'result'];
  k text;
  oc int := coalesce(jsonb_array_length(old.data->'comments'), 0);
  can_edit boolean;
  involved boolean;
  reviewer boolean;
begin
  if auth.uid() is null then return new; end if;
  if r is null then raise exception 'Учётная запись не активна'; end if;
  can_edit := r in ('head', 'staff') or (r = 'coordinator' and my_district() = o->>'districtId') or o->>'authorId' = u;
  involved := o->>'assigneeId' = u or (o->'coAssigneeIds') ? u;
  reviewer := s0 = 'review' and o->>'assigneeId' <> u and (r = 'head' or (r = 'coordinator' and my_district() = o->>'districtId'));
  if s0 = 'done' and r <> 'head' then can_edit := false; end if;

  -- Комментарии только дописываются и только от своего имени
  if coalesce(jsonb_array_length(n->'comments'), 0) < oc
     or (oc > 0 and (select jsonb_agg(e order by i) from jsonb_array_elements(n->'comments') with ordinality x(e, i) where i <= oc) is distinct from o->'comments')
     or exists (select 1 from jsonb_array_elements(n->'comments') with ordinality x(e, i) where i > oc and e->>'authorId' <> u) then
    raise exception 'Комментарии нельзя изменять или удалять';
  end if;

  -- Без прав редактирования менять можно только чек-лист, вложения, комментарии и свой результат
  if not can_edit and (o - free_keys) is distinct from (n - free_keys) then
    raise exception 'Изменять параметры задачи могут автор, координатор округа и руководители';
  end if;
  if s0 = 'done' and r <> 'head' and (o - 'comments') is distinct from (n - 'comments') then
    raise exception 'Выполненную задачу может изменить только руководитель области';
  end if;
  if n->>'districtId' is distinct from o->>'districtId' and not can_assign(n->>'districtId') then
    raise exception 'Нельзя перенести задачу в чужой округ';
  end if;

  -- Служебные поля задаёт только сервер
  foreach k in array sys_keys loop
    n := case when o ? k then jsonb_set(n, array[k], o->k) else n - k end;
  end loop;

  if s1 is distinct from s0 then
    if s0 = 'new' and s1 = 'in_progress' and (can_edit or involved) then
      null;
    elsif s0 = 'in_progress' and s1 = 'new' and can_edit then
      null;
    elsif s0 in ('new', 'in_progress') and s1 = 'review' and involved then
      if length(trim(coalesce(cr->>'text', ''))) < 5 then raise exception 'Опишите результат — хотя бы одно предложение'; end if;
      if n->>'metricId' is not null and (cr->>'value') is null then raise exception 'Укажите фактическое значение показателя'; end if;
      n := jsonb_set(n, '{result}', cr || jsonb_build_object('submittedAt', now(), 'submittedDate', msk_today()));
    elsif reviewer and s1 = 'done' then
      n := n || jsonb_build_object('confirmedAt', msk_today(), 'confirmedBy', u);
    elsif reviewer and s1 = 'in_progress' then
      if not exists (select 1 from jsonb_array_elements(n->'comments') with ordinality x(e, i)
                     where i > oc and e->>'kind' = 'return' and length(trim(e->>'text')) >= 5) then
        raise exception 'При возврате на доработку обязателен комментарий';
      end if;
      n := n || jsonb_build_object('returnedAt', now());
    elsif s1 = 'cancelled' and ((can_edit and s0 in ('new', 'in_progress')) or r = 'head') then
      null;
    elsif s0 = 'review' and s1 in ('done', 'in_progress') then
      raise exception 'Подтверждать или возвращать результат может координатор округа или руководитель, и не по своей задаче';
    else
      raise exception 'Такой переход статуса недоступен вашей роли';
    end if;
  end if;

  new.data := n;
  new.updated_at := now();
  return new;
end $$;
create trigger tasks_update_guard before update on tasks for each row execute function tasks_update_guard();

/* ───────── Мероприятия ───────── */
create or replace function events_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if length(trim(coalesce(new.data->>'title', ''))) < 3 then raise exception 'Введите название мероприятия'; end if;
  if new.data->>'end' <= new.data->>'start' then raise exception 'Окончание должно быть позже начала'; end if;
  if tg_op = 'UPDATE' and my_role() = 'coordinator' and new.data->>'districtId' is distinct from old.data->>'districtId' then
    raise exception 'Координатор не может перенести мероприятие в другой округ';
  end if;
  new.data := jsonb_set(new.data, '{id}', to_jsonb(new.id));
  new.updated_at := now();
  return new;
end $$;
create trigger events_guard before insert or update on events for each row execute function events_guard();

/* ───────── Отчёты ───────── */
create or replace function reports_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare s0 text; s1 text := new.data->>'status';
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.data := new.data || jsonb_build_object('id', new.id, 'status', 'draft');
    return new;
  end if;
  s0 := old.data->>'status';
  if s1 is distinct from s0 then
    if s0 in ('draft', 'returned') and s1 = 'sent' and (is_head() or is_coord_of(old.data->>'districtId')) then
      if length(trim(coalesce(new.data->>'conclusions', ''))) = 0 then raise exception 'Заполните поле «Выводы» — без него отчёт нельзя отправить'; end if;
    elsif s0 = 'sent' and s1 = 'accepted' and is_head() then
      null;
    elsif s0 = 'sent' and s1 = 'returned' and is_head() then
      if length(trim(coalesce(new.data->>'returnComment', ''))) < 5 then raise exception 'Напишите, что нужно исправить в отчёте'; end if;
    else
      raise exception 'Такое изменение статуса отчёта недоступно вашей роли';
    end if;
  elsif s0 in ('sent', 'accepted') and not is_head() then
    raise exception 'Отчёт уже отправлен — редактирование закрыто до проверки';
  end if;
  new.data := jsonb_set(new.data, '{id}', to_jsonb(old.id));
  new.updated_at := now();
  return new;
end $$;
create trigger reports_guard before insert or update on reports for each row execute function reports_guard();

/* ───────── Журнал значимых изменений ───────── */
create or replace function write_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (entity, entity_id, action, old_data, new_data)
  values (tg_table_name, coalesce(new.id, old.id)::text, lower(tg_op),
          case when tg_op <> 'INSERT' then old.data end, case when tg_op <> 'DELETE' then new.data end);
  return coalesce(new, old);
end $$;
create trigger audit after insert or update or delete on tasks for each row execute function write_audit();
create trigger audit after insert or update or delete on events for each row execute function write_audit();
create trigger audit after insert or update or delete on reports for each row execute function write_audit();
create trigger audit after insert or update on profiles for each row execute function write_audit();
create trigger audit after insert or update or delete on districts for each row execute function write_audit();
create trigger audit after insert or update on metrics for each row execute function write_audit();

/* ───────── Telegram: отправка уведомлений ───────── */
create or replace function notify_telegram() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare url text; secret text;
begin
  if not exists (select 1 from telegram_links where user_id = new.user_id) then return new; end if;
  select value into url from app_secrets where key = 'functions_url';
  select value into secret from app_secrets where key = 'hook_secret';
  if url is null then return new; end if;
  perform net.http_post(
    url := url || '/telegram',
    body := jsonb_build_object('type', 'notify', 'user_id', new.user_id, 'text', new.data->>'text', 'link', new.data->>'link'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', secret));
  return new;
end $$;
create trigger notify_telegram after insert on notifications for each row execute function notify_telegram();

/* ───────── Ежедневные напоминания о сроках (9:00 МСК) ───────── */
create or replace function deadline_reminders() returns void language plpgsql security definer set search_path = public as $$
declare
  today text := msk_today();
  tomorrow text := to_char((now() at time zone 'Europe/Moscow')::date + 1, 'YYYY-MM-DD');
begin
  insert into notifications (id, user_id, data)
  select 'dl_' || t.id || '_' || (t.data->>'due'), (t.data->>'assigneeId')::uuid,
         jsonb_build_object('id', 'dl_' || t.id || '_' || (t.data->>'due'), 'userId', t.data->>'assigneeId',
           'text', 'Срок ' || case when t.data->>'due' = today then 'сегодня' else 'завтра' end || ': «' || (t.data->>'title') || '»',
           'at', now(), 'read', false, 'link', '#/tasks/' || t.id, 'kind', 'deadline')
  from tasks t
  where t.data->>'status' in ('new', 'in_progress') and t.data->>'due' in (today, tomorrow)
    and exists (select 1 from profiles p where p.id::text = t.data->>'assigneeId')
  on conflict (id) do nothing;
end $$;
select cron.schedule('deadline-reminders', '0 6 * * *', 'select public.deadline_reminders()');

/* ───────── Онлайн-обновления ───────── */
alter publication supabase_realtime add table tasks, events, reports, notifications, profiles, districts, metrics, settings, telegram_links;

/* ───────── Справочники ───────── */
insert into districts (id, data) values
  ('istra', '{"id":"istra","name":"Истра","coordinatorId":null,"pos":[128,122]}'),
  ('krasnogorsk', '{"id":"krasnogorsk","name":"Красногорск","coordinatorId":null,"pos":[176,138]}'),
  ('khimki', '{"id":"khimki","name":"Химки","coordinatorId":null,"pos":[188,112]}'),
  ('odintsovo', '{"id":"odintsovo","name":"Одинцово","coordinatorId":null,"pos":[160,165]}'),
  ('mytishchi', '{"id":"mytishchi","name":"Мытищи","coordinatorId":null,"pos":[224,108]}'),
  ('podolsk', '{"id":"podolsk","name":"Подольск","coordinatorId":null,"pos":[204,210]}'),
  ('balashikha', '{"id":"balashikha","name":"Балашиха","coordinatorId":null,"pos":[254,146]}'),
  ('kolomna', '{"id":"kolomna","name":"Коломна","coordinatorId":null,"pos":[318,238]}');
insert into metrics (id, data) values
  ('m_meet', '{"id":"m_meet","name":"Встречи с жителями","unit":"встреч","monthlyPlan":2,"weight":1,"description":"Проведённые дворовые встречи и встречи в ЖК. Каждая подтверждённая задача-встреча даёт 1."}'),
  ('m_appeals', '{"id":"m_appeals","name":"Обращения жителей","unit":"обращений","monthlyPlan":28,"weight":1,"description":"Принятые и зарегистрированные обращения граждан. Значение указывает исполнитель при сдаче результата."}'),
  ('m_supporters', '{"id":"m_supporters","name":"Новые сторонники","unit":"чел.","monthlyPlan":16,"weight":1.5,"description":"Люди, оставившие контакты и согласие на связь. Значение указывает исполнитель."}'),
  ('m_events', '{"id":"m_events","name":"Проведённые мероприятия","unit":"мероприятий","monthlyPlan":2,"weight":1,"description":"Публичные мероприятия округа: субботники, турниры, лекции."}');
insert into settings values ('weights', '{"personCompletion":40,"personOnTime":30,"personVolume":30,"districtPlan":50,"districtCompletion":25,"districtOnTime":25,"priority":{"low":0.5,"normal":1,"high":1.5,"urgent":2},"lateFactor":0.7,"minTasks":3}');
insert into app_secrets values ('functions_url', 'https://wlqwwhshqrqanapsnsik.supabase.co/functions/v1');
insert into app_secrets values ('app_url', 'https://timativ-blip.github.io/nlMO/');
