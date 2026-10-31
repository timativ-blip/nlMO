-- Additive workflow tools. Existing task/report policies and triggers are unchanged.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create table public.task_templates (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table public.task_schedules (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table public.media_matches (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table public.task_workflow_requests (
  owner_id uuid not null references public.profiles(id), request_id text not null,
  payload jsonb not null, task_ids text[] not null default '{}', schedule_id text,
  created_at timestamptz not null default now(), primary key (owner_id, request_id)
);
alter table public.task_templates enable row level security;
alter table public.task_schedules enable row level security;
alter table public.media_matches enable row level security;
alter table public.task_workflow_requests enable row level security;
revoke all on public.task_templates, public.task_schedules, public.media_matches, public.task_workflow_requests from public,anon,authenticated;
grant select, insert, update on public.task_templates, public.task_schedules, public.media_matches to authenticated;
grant select, insert on public.task_workflow_requests to authenticated;

create policy templates_read on public.task_templates for select to authenticated using (
  public.my_role() in ('head','staff','coordinator') and (data->>'ownerId'=auth.uid()::text or data->>'shared'='true' or public.is_head()));
create policy templates_insert on public.task_templates for insert to authenticated with check (
  public.my_role() in ('head','staff','coordinator') and data->>'ownerId'=auth.uid()::text);
create policy templates_update on public.task_templates for update to authenticated using (
  data->>'ownerId'=auth.uid()::text or public.is_head()) with check (data->>'ownerId'=auth.uid()::text or public.is_head());
create policy schedules_read on public.task_schedules for select to authenticated using (data->>'ownerId'=auth.uid()::text or public.is_head());
create policy schedules_insert on public.task_schedules for insert to authenticated with check (public.my_role() in ('head','staff','coordinator') and data->>'ownerId'=auth.uid()::text);
create policy schedules_update on public.task_schedules for update to authenticated using (data->>'ownerId'=auth.uid()::text or public.is_head()) with check (data->>'ownerId'=auth.uid()::text or public.is_head());
create policy matches_read on public.media_matches for select to authenticated using (public.my_role() is not null);
create policy matches_insert on public.media_matches for insert to authenticated with check (public.can_assign(data->>'groupId'));
create policy matches_update on public.media_matches for update to authenticated using (public.can_assign(data->>'groupId')) with check (public.can_assign(data->>'groupId'));
create policy requests_read on public.task_workflow_requests for select to authenticated using (owner_id=auth.uid());
create policy requests_insert on public.task_workflow_requests for insert to authenticated with check (owner_id=auth.uid() and public.my_role() in ('head','staff','coordinator'));

create function app_private.next_task_occurrence(anchor date, frequency text, after_day date) returns date
language plpgsql immutable set search_path='' as $$
declare candidate date; month_start date; desired integer := extract(day from anchor);
begin
  if frequency not in ('weekly','monthly') then raise exception 'Неизвестное повторение'; end if;
  if anchor > after_day then return anchor; end if;
  if frequency='weekly' then return anchor + (((after_day-anchor)/7)+1)*7; end if;
  month_start := date_trunc('month',after_day)::date;
  candidate := month_start + least(desired,extract(day from (month_start+interval '1 month - 1 day')))::integer-1;
  if candidate <= after_day then
    month_start := (month_start+interval '1 month')::date;
    candidate := month_start + least(desired,extract(day from (month_start+interval '1 month - 1 day')))::integer-1;
  end if;
  return candidate;
end $$;

create function app_private.assert_workflow_body(body jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
  if jsonb_typeof(body) is distinct from 'object' or jsonb_typeof(body->'title') is distinct from 'string' or jsonb_typeof(body->'description') is distinct from 'string' or length(trim(coalesce(body->>'title',''))) not between 3 and 200 then raise exception 'Название должно содержать от 3 до 200 символов'; end if;
  if length(coalesce(body->>'description',''))>12000 or coalesce(body->>'priority','') not in ('low','normal','high','urgent') then raise exception 'Проверьте описание и приоритет'; end if;
  if jsonb_typeof(body->'checklist') is distinct from 'array' or jsonb_typeof(body->'links') is distinct from 'array' then raise exception 'Некорректный чек-лист или ссылки'; end if;
  if jsonb_array_length(body->'checklist')>100 or jsonb_array_length(body->'links')>30 then raise exception 'Слишком много пунктов или ссылок'; end if;
  for item in select value from jsonb_array_elements(body->'checklist') loop
    if jsonb_typeof(item)<>'string' or length(item#>>'{}')>1000 then raise exception 'Некорректный пункт чек-листа'; end if;
  end loop;
  for item in select value from jsonb_array_elements(body->'links') loop
    if jsonb_typeof(item)<>'string' or (item#>>'{}') !~* '^https?://' or length(item#>>'{}')>3000 then raise exception 'Ссылки должны начинаться с https:// или http://'; end if;
  end loop;
end $$;

create function app_private.assert_task_workflow(body jsonb, targets jsonb, due text, actor uuid) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare role_name text; actor_district text; target jsonb; person jsonb;
begin
  if (auth.uid() is not null and auth.uid()<>actor) or (auth.uid() is null and current_user not in ('postgres','supabase_admin','service_role')) then raise exception 'Недостаточно прав'; end if;
  select data->>'role', data->>'districtId' into role_name,actor_district from public.profiles
    where id=actor and coalesce((data->>'active')::boolean,false) and not coalesce((data->>'pending')::boolean,false);
  if role_name is null or role_name not in ('head','staff','coordinator') then raise exception 'Недостаточно прав для постановки задач'; end if;
  perform app_private.assert_workflow_body(body);
  if due is null or due !~ '^\d{4}-\d{2}-\d{2}$' or to_char(due::date,'YYYY-MM-DD')<>due or due::date < (now() at time zone 'Europe/Moscow')::date then raise exception 'Срок должен быть сегодня или позже'; end if;
  if jsonb_typeof(targets) is distinct from 'array' or jsonb_array_length(targets) not between 1 and 100 then raise exception 'Выберите округа'; end if;
  if (select count(*)<>count(distinct value->>'districtId') from jsonb_array_elements(targets)) then raise exception 'Округа не должны повторяться'; end if;
  if body->>'metricId' is not null and not exists(select 1 from public.metrics where id=body->>'metricId') then raise exception 'Показатель не найден'; end if;
  for target in select value from jsonb_array_elements(targets) loop
    if not exists(select 1 from public.districts where id=target->>'districtId') then raise exception 'Округ не найден'; end if;
    if role_name='coordinator' and actor_district is distinct from target->>'districtId' then raise exception 'Нельзя поставить задачу в чужой округ'; end if;
    select data into person from public.profiles where id::text=target->>'assigneeId' and data->>'active'='true' and not coalesce((data->>'pending')::boolean,false);
    if person is null or (person->>'districtId' is not null and person->>'districtId' is distinct from target->>'districtId') or (role_name='coordinator' and person->>'districtId' is distinct from actor_district) then raise exception 'Укажите активного ответственного своего округа или штаба'; end if;
    if body->>'eventId' is not null and not exists(select 1 from public.events where id=body->>'eventId' and not coalesce((data->>'cancelled')::boolean,false) and (data->>'districtId' is null or data->>'districtId'=target->>'districtId')) then raise exception 'Мероприятие не подходит выбранным округам'; end if;
  end loop;
end $$;

create function app_private.insert_workflow_tasks(body jsonb, targets jsonb, due text, actor uuid, batch_key text, schedule_id text default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare target jsonb; task_id text; document jsonb; saved jsonb; result jsonb := '[]'; was_inserted boolean;
begin
  perform app_private.assert_task_workflow(body,targets,due,actor);
  for target in select value from jsonb_array_elements(targets) loop
    task_id := 'tw_'||md5(actor::text||':'||batch_key||':'||(target->>'districtId'));
    document := jsonb_build_object('id',task_id,'batchId',batch_key,'title',trim(body->>'title'),'description',trim(coalesce(body->>'description','')),
      'districtId',target->>'districtId','assigneeId',target->>'assigneeId','coAssigneeIds','[]'::jsonb,'authorId',actor::text,'due',due,
      'priority',body->>'priority','status','new','comments','[]'::jsonb,'result',null,'createdAt',now(),'metricId',body->'metricId','eventId',body->'eventId',
      'checklist',coalesce((select jsonb_agg(jsonb_build_object('id','c_'||gen_random_uuid()::text,'text',trim(value),'done',false)) from jsonb_array_elements_text(body->'checklist') where trim(value)<>''),'[]'),
      'attachments',coalesce((select jsonb_agg(jsonb_build_object('id','a_'||gen_random_uuid()::text,'name',value,'url',value,'kind','link')) from jsonb_array_elements_text(body->'links')),'[]'),
      'history',jsonb_build_array(jsonb_build_object('at',now(),'userId',actor::text,'text',case when schedule_id is null then 'Создано отдельное поручение для округа.' else 'Задача создана по расписанию.' end)));
    if schedule_id is not null then document:=document||jsonb_build_object('scheduleId',schedule_id); end if;
    insert into public.tasks(id,data) values(task_id,document) on conflict(id) do nothing returning data into saved;
    was_inserted := found;
    if not was_inserted then
      select data into saved from public.tasks where id=task_id;
      if saved is null or saved->>'authorId'<>actor::text or saved->>'batchId'<>batch_key or saved->>'assigneeId'<>target->>'assigneeId' or saved->>'title'<>trim(body->>'title') then raise exception 'Идентификатор поручения уже занят'; end if;
    end if;
    if was_inserted and target->>'assigneeId'<>actor::text then
      insert into public.notifications(id,user_id,data) values('wf_assign_'||task_id,(target->>'assigneeId')::uuid,
        jsonb_build_object('id','wf_assign_'||task_id,'userId',target->>'assigneeId','text','Новое поручение: «'||trim(body->>'title')||'», срок '||due,'at',now(),'read',false,'link','#/tasks/'||task_id,'kind','assign'));
    end if;
    result := result||jsonb_build_array(saved);
  end loop;
  return result;
end $$;

create function app_private.workflow_document_guard() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare owner_id text; target_user jsonb; group_id text; today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if auth.uid() is null then
    if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
    raise exception 'Необходим вход';
  end if;
  if public.my_role() is null then raise exception 'Учётная запись не активна'; end if;
  owner_id := case when tg_op='UPDATE' then old.data->>'ownerId' else auth.uid()::text end;
  new.data := new.data||jsonb_build_object('id',new.id,'ownerId',owner_id,'updatedAt',now());
  new.updated_at := now();
  if tg_table_name='task_templates' then
    if public.my_role() not in ('head','staff','coordinator') or (tg_op='UPDATE' and owner_id<>auth.uid()::text and not public.is_head()) then raise exception 'Недостаточно прав на шаблон'; end if;
    if length(trim(coalesce(new.data->>'name',''))) not between 3 and 200 or length(trim(coalesce(new.data->'body'->>'title',''))) not between 3 and 200 then raise exception 'Укажите название шаблона и задачи'; end if;
    perform app_private.assert_workflow_body(new.data->'body');
    if new.data->>'deadlineDays' is null or (new.data->>'deadlineDays')::integer not between 0 and 365 then raise exception 'Срок выполнения от 0 до 365 дней'; end if;
    if jsonb_typeof(new.data->'shared') is distinct from 'boolean' or jsonb_typeof(new.data->'archived') is distinct from 'boolean' then raise exception 'Некорректные параметры шаблона'; end if;
    if coalesce((new.data->>'shared')::boolean,false) and not public.is_manager() then raise exception 'Общие шаблоны создаёт штаб или руководство'; end if;
  elsif tg_table_name='task_schedules' then
    if public.my_role() not in ('head','staff','coordinator') or (tg_op='UPDATE' and owner_id<>auth.uid()::text and not public.is_head()) then raise exception 'Недостаточно прав на расписание'; end if;
    if jsonb_typeof(new.data->'enabled') is distinct from 'boolean' then raise exception 'Некорректное состояние расписания'; end if;
    if tg_op='UPDATE' then
      if (new.data-array['enabled','lastError','updatedAt']) is distinct from (old.data-array['enabled','lastError','updatedAt']) then raise exception 'Параметры действующего расписания неизменны. Приостановите его и создайте новое'; end if;
      new.data:=new.data||jsonb_build_object('lastError',case when new.data->>'enabled'='true' then '' else coalesce(old.data->>'lastError','') end);
    else
      if coalesce(new.data->>'nextRun','') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((new.data->>'nextRun')::date,'YYYY-MM-DD')<>new.data->>'nextRun' or (new.data->>'nextRun')::date<(new.data->'rule'->>'start')::date or jsonb_typeof(new.data->'enabled') is distinct from 'boolean' then raise exception 'Некорректный следующий запуск'; end if;
      perform app_private.assert_task_workflow(new.data->'body',new.data->'targets',to_char(greatest((new.data->'rule'->>'start')::date,today)+(new.data->'rule'->>'deadlineDays')::integer,'YYYY-MM-DD'),auth.uid());
      if coalesce(new.data->'rule'->>'frequency','') not in ('weekly','monthly') or new.data->'rule'->>'deadlineDays' is null or (new.data->'rule'->>'deadlineDays')::integer not between 0 and 365 or coalesce(new.data->'rule'->>'start','') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((new.data->'rule'->>'start')::date,'YYYY-MM-DD')<>new.data->'rule'->>'start' or (new.data->'rule'->>'start')::date<today or coalesce(new.data->'rule'->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Проверьте параметры повторения'; end if;
    end if;
  else
    if jsonb_typeof(new.data->'active') is distinct from 'boolean' then raise exception 'Некорректное состояние сопоставления'; end if;
    if tg_op='UPDATE' and new.data->>'sourceName' is distinct from old.data->>'sourceName' then raise exception 'Источник сопоставления неизменен'; end if;
    if length(trim(coalesce(new.data->>'sourceName',''))) not between 2 and 200 or new.id<>'media:'||replace(lower(trim(regexp_replace(new.data->>'sourceName','\s+',' ','g'))),'ё','е') then raise exception 'Некорректное имя автора'; end if;
    group_id:=new.data->>'groupId';
    if not public.can_assign(group_id) or (group_id<>'hq' and not exists(select 1 from public.districts where id=group_id)) then raise exception 'Недостаточно прав на округ'; end if;
    if new.data->>'userId' is not null then
      select data into target_user from public.profiles where id::text=new.data->>'userId' and data->>'active'='true' and not coalesce((data->>'pending')::boolean,false);
      if target_user is null or coalesce(target_user->>'districtId','hq')<>group_id then raise exception 'Человек должен относиться к выбранному округу'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger workflow_guard before insert or update on public.task_templates for each row execute function app_private.workflow_document_guard();
create trigger workflow_guard before insert or update on public.task_schedules for each row execute function app_private.workflow_document_guard();
create trigger workflow_guard before insert or update on public.media_matches for each row execute function app_private.workflow_document_guard();
create trigger audit after insert or update on public.task_templates for each row execute function public.write_audit();
create trigger audit after insert or update on public.task_schedules for each row execute function public.write_audit();
create trigger audit after insert or update on public.media_matches for each row execute function public.write_audit();

create function public.launch_task_workflow(request_id text, body jsonb, targets jsonb, due text, repeat_rule jsonb default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); today date:=(now() at time zone 'Europe/Moscow')::date; clock time:=(now() at time zone 'Europe/Moscow')::time;
  payload jsonb:=jsonb_build_object('body',body,'targets',targets,'due',due,'repeat',repeat_rule);
  receipt public.task_workflow_requests%rowtype; documents jsonb:='[]'; schedule jsonb:=null; schedule_id text; run_now boolean:=true;
begin
  if actor is null or public.my_role() not in ('head','staff','coordinator') then raise exception 'Недостаточно прав'; end if;
  if request_id is null or request_id !~ '^[A-Za-z0-9_-]{8,100}$' then raise exception 'Некорректный идентификатор запроса'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||request_id,0));
  select * into receipt from public.task_workflow_requests r where r.owner_id=actor and r.request_id=launch_task_workflow.request_id;
  if found then
    if receipt.payload<>payload then raise exception 'Параметры отправленного запроса изменились. Создайте новое поручение'; end if;
    return jsonb_build_object('tasks',coalesce((select jsonb_agg(t.data order by array_position(receipt.task_ids,t.id)) from public.tasks t where t.id=any(receipt.task_ids)),'[]'),
      'schedule',(select s.data from public.task_schedules s where s.id=receipt.schedule_id));
  end if;
  perform app_private.assert_task_workflow(body,targets,due,actor);
  if repeat_rule is not null then
    if jsonb_typeof(repeat_rule) is distinct from 'object' or coalesce(repeat_rule->>'frequency','') not in ('weekly','monthly') or coalesce(repeat_rule->>'start','') !~ '^\d{4}-\d{2}-\d{2}$' or to_char((repeat_rule->>'start')::date,'YYYY-MM-DD')<>repeat_rule->>'start' or (repeat_rule->>'start')::date<today or coalesce(repeat_rule->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or repeat_rule->>'deadlineDays' is null or (repeat_rule->>'deadlineDays')::integer not between 0 and 365 then raise exception 'Проверьте дату, время и срок повторения'; end if;
    schedule_id:='sc_'||md5(actor::text||':'||request_id);
    run_now:=(repeat_rule->>'start')::date=today and (repeat_rule->>'time')::time<=clock;
    schedule:=jsonb_build_object('id',schedule_id,'ownerId',actor::text,'body',body,'targets',targets,'rule',repeat_rule,'enabled',true,'createdAt',now(),
      'nextRun',case when run_now then app_private.next_task_occurrence((repeat_rule->>'start')::date,repeat_rule->>'frequency',today)::text else repeat_rule->>'start' end);
    if run_now then schedule:=schedule||jsonb_build_object('lastRun',today::text); end if;
    insert into public.task_schedules(id,data) values(schedule_id,schedule) returning data into schedule;
  end if;
  if run_now then documents:=app_private.insert_workflow_tasks(body,targets,case when repeat_rule is null then due else (today+(repeat_rule->>'deadlineDays')::integer)::text end,actor,request_id,schedule_id); end if;
  insert into public.task_workflow_requests(owner_id,request_id,payload,task_ids,schedule_id)
    values(actor,request_id,payload,array(select value->>'id' from jsonb_array_elements(documents)),schedule_id);
  return jsonb_build_object('tasks',documents,'schedule',schedule);
end $$;

create function app_private.run_task_schedules() returns integer language plpgsql security definer set search_path='' as $$
declare job record; actor uuid; today date:=(now() at time zone 'Europe/Moscow')::date; clock time:=(now() at time zone 'Europe/Moscow')::time; created integer:=0; documents jsonb;
begin
  for job in select * from public.task_schedules where data->>'enabled'='true' and (data->>'nextRun')::date<=today
    and ((data->>'nextRun')::date<today or (data->'rule'->>'time')::time<=clock) for update skip locked loop
    begin
      actor:=(job.data->>'ownerId')::uuid;
      documents:=app_private.insert_workflow_tasks(job.data->'body',job.data->'targets',(today+(job.data->'rule'->>'deadlineDays')::integer)::text,actor,job.id||'_'||(job.data->>'nextRun'),job.id);
      update public.task_schedules set data=data||jsonb_build_object('nextRun',app_private.next_task_occurrence((job.data->'rule'->>'start')::date,job.data->'rule'->>'frequency',today)::text,'lastRun',today::text,'lastError',''),updated_at=now() where id=job.id;
      created:=created+jsonb_array_length(documents);
    exception when others then
      update public.task_schedules set data=data||jsonb_build_object('enabled',false,'lastError',left(sqlerrm,300)),updated_at=now() where id=job.id;
    end;
  end loop;
  return created;
end $$;

revoke all on function public.launch_task_workflow(text,jsonb,jsonb,text,jsonb) from public,anon;
grant execute on function public.launch_task_workflow(text,jsonb,jsonb,text,jsonb) to authenticated;
revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on function app_private.next_task_occurrence(date,text,date), app_private.assert_workflow_body(jsonb), app_private.assert_task_workflow(jsonb,jsonb,text,uuid), app_private.insert_workflow_tasks(jsonb,jsonb,text,uuid,text,text) to authenticated;

do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('task-workflows','* * * * *','select app_private.run_task_schedules()');
  end if;
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.task_templates,public.task_schedules,public.media_matches;
  end if;
end $$;
