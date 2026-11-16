-- Explicit review reasons; preserve all historical comments and old-client compatibility.
create schema if not exists app_private;
create function app_private.task_quality_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare previous_count int:=0; item jsonb; items jsonb:='[]'; idx int:=0; returns int:=0; genuine boolean:=false; actor jsonb;
begin
 if auth.uid() is null then return new; end if;
 select data into actor from public.profiles where id=auth.uid();
 if tg_op='UPDATE' then
  previous_count:=coalesce(jsonb_array_length(old.data->'comments'),0);
  genuine:=old.data->>'status'='review' and new.data->>'status'='in_progress' and old.data->>'assigneeId'<>auth.uid()::text
   and (actor->>'role'='head' or actor->>'role'='coordinator' and actor->>'districtId'=old.data->>'districtId')
   and coalesce((actor->>'active')::boolean,true) and not coalesce((actor->>'pending')::boolean,false);
 end if;
 for item in select value from jsonb_array_elements(coalesce(new.data->'comments','[]')) loop
  idx:=idx+1;
  if idx>previous_count then
   if item->>'kind'='return' then
    returns:=returns+1;
    if not coalesce(genuine,false) or item->>'authorId' is distinct from auth.uid()::text or length(trim(coalesce(item->>'text','')))<5 then raise exception 'Возврат возможен только при проверке результата с комментарием'; end if;
    if item ? 'reworkReason' and coalesce(item->>'reworkReason','') not in ('requirements','evidence','accuracy','completeness','format','other','unspecified') then raise exception 'Выберите причину возврата'; end if;
    item:=item||jsonb_build_object('at',now(),'reworkReason',coalesce(item->>'reworkReason','unspecified'));
   elsif item ? 'reworkReason' then raise exception 'Причина относится только к возврату результата';
   end if;
  end if;
  items:=items||jsonb_build_array(item);
 end loop;
 if genuine and returns<>1 then raise exception 'Укажите один комментарий с причиной возврата'; end if;
 new.data:=jsonb_set(new.data,'{comments}',items);return new;
end $$;
revoke all on function app_private.task_quality_guard() from public,anon,authenticated;
create trigger tasks_quality_guard before insert or update on public.tasks for each row execute function app_private.task_quality_guard();

-- Private receipts make a retry after a lost response safe. No client can read other users' receipts.
create table app_private.report_operations (
 user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null, body jsonb not null, response jsonb not null, created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
alter table app_private.report_operations enable row level security;
revoke all on app_private.report_operations from public,anon,authenticated;
create function app_private.save_queued_report(p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<report_save>>
declare
 uid uuid:=auth.uid(); actor jsonb; rid uuid; receipt app_private.report_operations; kind text:=p_body->>'kind';
 intent text:=p_body->>'intent'; fields jsonb:=p_body->'fields'; id text; day text; district text; ws text;
 old_record jsonb; next_record jsonb; reply jsonb; revision text; k text; exists_row boolean; changed boolean;
begin
 select data into actor from public.profiles where profiles.id=uid;
 if uid is null or p_body->>'userId' is distinct from uid::text or actor is null or not coalesce(actor->>'role' in ('head','staff','coordinator'),false)
  or not coalesce((actor->>'active')::boolean,true) or coalesce((actor->>'pending')::boolean,false) then
  return jsonb_build_object('ok',false,'kind','blocked','message','Войдите в свою активную учётную запись. Текст остался на устройстве.');
 end if;
 if pg_column_size(p_body)>180000 or jsonb_typeof(fields) is distinct from 'object' then raise exception 'Некорректный отчёт'; end if;
 rid:=(p_body->>'id')::uuid;
 if rid is null or kind not in ('daily','weekly') or intent not in ('save','send') or kind is null or intent is null then raise exception 'Некорректная операция отчёта'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||rid::text,0));
 select * into receipt from app_private.report_operations where user_id=uid and request_id=rid;
 if found then
  if receipt.body is distinct from p_body then raise exception 'Нельзя изменить уже отправленную версию. Создайте новую операцию'; end if;
  return receipt.response;
 end if;
 foreach k in array case when kind='daily' then array['done','plan','problems'] else array['conclusions','plan','problems'] end loop
  if jsonb_typeof(fields->k) is distinct from 'string' or length(fields->>k)>30000 then raise exception 'Поля отчёта должны содержать текст до 30 000 символов'; end if;
 end loop;
 if kind='daily' then
  day:=p_body->>'day';
  if day is null or day !~ '^\d{4}-\d{2}-\d{2}$' or to_char(day::date,'YYYY-MM-DD')<>day or day>public.msk_today() or day<to_char((now() at time zone 'Europe/Moscow')::date-2,'YYYY-MM-DD') then
   return jsonb_build_object('ok',false,'kind','blocked','message','Этот день закрыт для отправки: доступны сегодня и два предыдущих дня. Текст сохранён в очереди.');
  end if;
  if intent<>'save' or length(trim(fields->>'done'))<10 then raise exception 'Опишите, что сделано за день — хотя бы одно предложение'; end if;
  id:='dr_'||uid::text||'_'||day;
 else
  id:=p_body->>'reportId';district:=p_body->>'districtId';ws:=p_body->>'weekStart';
  if id is null or length(id)>250 or district is null or not exists(select 1 from public.districts where districts.id=district)
   or ws is null or ws !~ '^\d{4}-\d{2}-\d{2}$' or to_char(ws::date,'YYYY-MM-DD')<>ws or extract(isodow from ws::date)<>1 or ws>public.msk_today() then raise exception 'Некорректная неделя или округ'; end if;
  if not (actor->>'role'='head' or actor->>'role'='coordinator' and actor->>'districtId'=district) then return jsonb_build_object('ok',false,'kind','blocked','message','Отчёт может отправить координатор своего округа или руководитель.'); end if;
  if intent='send' and length(trim(fields->>'conclusions'))=0 then raise exception 'Заполните выводы перед отправкой'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(kind||':'||id,0));
 if kind='daily' then select data into old_record from public.daily_reports where user_id=uid and daily_reports.day=report_save.day for update;
 else select data into old_record from public.reports where reports.id=report_save.id for update; end if;
 exists_row:=old_record is not null;
 if kind='weekly' and exists_row and (old_record->>'districtId' is distinct from district or old_record->>'weekStart' is distinct from ws) then raise exception 'Неделя или округ не совпадает с отчётом'; end if;
 if kind='weekly' and not exists_row and id is distinct from 'r_'||district||'_'||ws then raise exception 'Некорректный номер отчёта'; end if;
 -- An identical already-committed value can be acknowledged even after a different tab saved it.
 changed:=not exists_row or exists(select 1 from jsonb_each(fields) f where old_record->f.key is distinct from f.value)
   or kind='weekly' and intent='send' and old_record->>'status'<>'sent';
 if not changed then reply:=jsonb_build_object('ok',true,'record',old_record);
 elsif kind='weekly' and exists_row and old_record->>'status' not in ('draft','returned') then
  reply:=jsonb_build_object('ok',false,'kind','conflict','message','Отчёт уже отправлен или принят. Сравните сохранённую версию со своим текстом.','server',old_record);
 elsif (old_record->>'updatedAt') is distinct from (p_body->>'baseRevision') then
  reply:=jsonb_build_object('ok',false,'kind','conflict','message','Отчёт изменился с другого устройства. Сравните версии перед отправкой.','server',old_record);
 else
  if kind='daily' then
   next_record:=coalesce(old_record,'{}')||fields||jsonb_build_object('id',coalesce(old_record->>'id',id),'userId',uid::text,'day',day,'updatedAt',now());
   insert into public.daily_reports(id,user_id,day,data) values(next_record->>'id',uid,day,next_record)
    on conflict on constraint daily_reports_user_id_day_key do update set data=excluded.data where (daily_reports.data->>'updatedAt') is not distinct from (p_body->>'baseRevision') returning data into next_record;
   if next_record is null then select data into old_record from public.daily_reports where user_id=uid and daily_reports.day=report_save.day; end if;
  else
   next_record:=coalesce(old_record,jsonb_build_object('id',id,'districtId',district,'weekStart',ws,'status','draft','history','[]'::jsonb))||fields||jsonb_build_object('updatedAt',now());
   if not exists_row then insert into public.reports(id,data) values(id,next_record) returning data into next_record; end if;
   if intent='send' then next_record:=next_record||jsonb_build_object('status','sent','history',coalesce(next_record->'history','[]')||jsonb_build_array(jsonb_build_object('at',now(),'userId',uid::text,'text','Отправил(а) отчёт на проверку'))); end if;
   if exists_row or intent='send' then update public.reports set data=next_record where reports.id=report_save.id returning data into next_record; end if;
   if intent='send' then
    insert into public.notifications(id,user_id,data)
    select 'qr_'||rid::text||'_'||p.id::text,p.id,jsonb_build_object('id','qr_'||rid::text||'_'||p.id::text,'userId',p.id::text,'at',now(),'read',false,'kind','report','link','#/reports/'||report_save.id,'text','Недельный отчёт округа '||coalesce(d.data->>'name',district)||' отправлен на проверку')
    from public.profiles p join public.districts d on d.id=district where p.data->>'role'='head' and p.id<>uid
     and coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false) on conflict do nothing;
   end if;
  end if;
  reply:=case when next_record is null then jsonb_build_object('ok',false,'kind','conflict','message','Отчёт изменился во время отправки. Сравните версии.','server',old_record) else jsonb_build_object('ok',true,'record',next_record) end;
 end if;
 insert into app_private.report_operations(user_id,request_id,body,response) values(uid,rid,p_body,reply);
 return reply;
exception when unique_violation then
 if kind='weekly' then select data into old_record from public.reports where reports.id=report_save.id;
 else select data into old_record from public.daily_reports where user_id=uid and daily_reports.day=report_save.day; end if;
 return jsonb_build_object('ok',false,'kind','conflict','message','Отчёт появился с другого устройства. Сравните версии.','server',old_record);
end $$;
revoke all on function app_private.save_queued_report(jsonb) from public,anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.save_queued_report(jsonb) to authenticated;
create function public.save_queued_report(p_body jsonb) returns jsonb language sql security invoker set search_path='' as $$select app_private.save_queued_report(p_body)$$;
revoke all on function public.save_queued_report(jsonb) from public,anon;
grant execute on function public.save_queued_report(jsonb) to authenticated;

-- Existing sent reports must not receive a missing-report reminder.
create or replace function app_private.weekly_report_reminders() returns void language plpgsql security definer set search_path=public as $$
declare day date:=(now() at time zone 'Europe/Moscow')::date; ws text; finish text;
begin
 ws:=to_char(day-(extract(isodow from day)::int-1)-case when extract(isodow from day)=1 then 7 else 0 end,'YYYY-MM-DD');
 finish:=to_char(ws::date+6,'DD.MM');
 insert into public.notifications(id,user_id,data)
 select 'wr_'||p.id::text||'_'||day::text,p.id,jsonb_build_object('id','wr_'||p.id::text||'_'||day::text,'userId',p.id::text,'at',now(),'read',false,'link','#/reports','kind','report',
 'text',format((array['Недельный отчёт округа за %s–%s ещё не отправлен. Проверьте показатели и дополните выводы.','Соберите итоги недели %s–%s: результаты, сложности и дальнейший план. Отчёт пока не сдан.','Осталось подвести итоги за %s–%s. Откройте недельный отчёт и отправьте его на проверку.'])[1+mod(extract(doy from day)::int+ascii(right(p.id::text,1)),3)],to_char(ws::date,'DD.MM'),finish))
 from public.profiles p where p.data->>'role'='coordinator' and p.data->>'districtId' is not null
 and coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)
 and not exists(select 1 from public.reports r where r.data->>'districtId'=p.data->>'districtId' and r.data->>'weekStart'=ws and r.data->>'status' in ('sent','accepted'))
 on conflict(id) do nothing;
end $$;
revoke all on function app_private.weekly_report_reminders() from public,anon,authenticated;
