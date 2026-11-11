-- Additive HQ workflows; existing tasks/reports/messages are not rewritten.
create schema hq_private;
revoke all on schema hq_private from public,anon,authenticated;
grant usage on schema hq_private to authenticated;
create function hq_private.active() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and data->>'role' in ('head','staff','coordinator') and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false))
$$;
create function hq_private.manager() returns boolean language sql stable security definer set search_path='' as $$
 select hq_private.active() and exists(select 1 from public.profiles where id=auth.uid() and data->>'role' in ('head','staff'))
$$;
create table public.hq_resources (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('room','equipment')),
 name text not null check(length(trim(name)) between 2 and 120),code text not null default '',description text not null default '',
 active boolean not null default true,created_by uuid references public.profiles,created_at timestamptz not null default now()
);
create table public.hq_reservations (
 id uuid primary key,resource_id uuid not null references public.hq_resources,borrower_id uuid not null references public.profiles,
 district_id text references public.districts,purpose text not null check(length(trim(purpose)) between 3 and 1000),
 starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at),
 status text not null default 'reserved' check(status in ('reserved','issued','returned','cancelled')),
 issued_at timestamptz,returned_at timestamptz,issue_note text not null default '',return_note text not null default '',
 updated_by uuid references public.profiles,version integer not null default 1,created_at timestamptz not null default now()
);
create index hq_reservation_schedule on public.hq_reservations(resource_id,starts_at,ends_at) where status in ('reserved','issued');
create index hq_reservation_borrower on public.hq_reservations(borrower_id,starts_at desc);
create index hq_reservation_district on public.hq_reservations(district_id) where district_id is not null;
create table public.hq_materials (
 id uuid primary key,parent_id uuid references public.hq_materials,kind text not null check(kind in ('folder','link')),
 name text not null check(length(trim(name)) between 2 and 160),url text not null default '',description text not null default '',
 archived boolean not null default false,updated_by uuid references public.profiles,updated_at timestamptz not null default now()
);
create index hq_material_parent on public.hq_materials(parent_id);
create table public.hq_minutes_archive (
 id uuid primary key,title text not null check(length(trim(title)) between 3 and 120),held_at timestamptz not null,
 owner_id uuid not null references public.profiles,responsible_id uuid not null references public.profiles,
 content jsonb not null,attachments jsonb not null default '[]',participant_ids uuid[] not null default '{}',
 version integer not null default 1,published_version integer not null default 0,published_at timestamptz,
 published_content jsonb,published_attachments jsonb,updated_at timestamptz not null default now()
);
create index hq_archive_date on public.hq_minutes_archive(held_at desc);
create index hq_archive_owner on public.hq_minutes_archive(owner_id);
create index hq_archive_responsible on public.hq_minutes_archive(responsible_id);
create table hq_private.requests (id uuid primary key,user_id uuid not null,body jsonb not null,result jsonb not null,created_at timestamptz not null default now());
alter table hq_private.requests enable row level security;
revoke all on hq_private.requests from public,anon,authenticated;
create function hq_private.archive_editor(doc uuid) returns boolean language sql stable security definer set search_path='' as $$
 select hq_private.active() and exists(select 1 from public.hq_minutes_archive where id=doc and (hq_private.manager() or auth.uid() in(owner_id,responsible_id)))
$$;
alter table public.hq_resources enable row level security;
alter table public.hq_reservations enable row level security;
alter table public.hq_materials enable row level security;
alter table public.hq_minutes_archive enable row level security;
revoke all on public.hq_resources,public.hq_reservations,public.hq_materials,public.hq_minutes_archive from public,anon,authenticated;
grant select on public.hq_resources,public.hq_reservations,public.hq_materials to authenticated;
create policy hq_resources_read on public.hq_resources for select to authenticated using((select hq_private.active()));
create policy hq_reservations_read on public.hq_reservations for select to authenticated using((select hq_private.active()));
create policy hq_materials_read on public.hq_materials for select to authenticated using((select hq_private.active()));
-- Archive drafts use dispatcher projections; no direct SELECT grant.
insert into public.hq_resources(kind,name,description) values('room','Штаб','Бронирование пространства штаба. Время московское.');
insert into public.hq_materials(id,kind,name,url,description) values(gen_random_uuid(),'folder','Материалы НЛ','https://drive.google.com/drive/folders/1GqXSG0pCzi8QpvVr47DxPCiiUTN7B7Al','Общая папка материалов. Доступ к файлам определяется настройками Google Диска.');
create function hq_private.notify(target uuid,nid text,message text,link text,kind text default 'event') returns void language sql security definer set search_path='' as $$
 insert into public.notifications(id,user_id,data) select nid,target,jsonb_build_object('id',nid,'userId',target,'text',message,'at',now(),'read',false,'link',link,'kind',kind)
 where exists(select 1 from public.profiles where id=target and data->>'role' in ('head','staff','coordinator') and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false)) on conflict do nothing
$$;
create function hq_private.archive_json(d public.hq_minutes_archive) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(d)-'content'-'attachments'||jsonb_build_object('can_edit',hq_private.archive_editor(d.id),'content',case when hq_private.archive_editor(d.id) then d.content else d.published_content end,'attachments',case when hq_private.archive_editor(d.id) then d.attachments else d.published_attachments end)
$$;
create function hq_private.dispatch(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); manager boolean; rid uuid; req uuid; previous hq_private.requests;
 resource public.hq_resources; booking public.hq_reservations; doc public.hq_minutes_archive;
 result jsonb; payload jsonb; start_time timestamptz; end_time timestamptz; target uuid; item jsonb; k text; url text;
begin
 if not hq_private.active() then raise exception 'Кабинет доступен координаторам, заместителям и сотрудникам штаба. Обратитесь к руководителю.' using errcode='42501'; end if;
 manager:=hq_private.manager();
 if p_action='ai_begin' then return hq_private.ai_claim(p_body); end if;
 if p_action='index' then
  return jsonb_build_object('resources',(select coalesce(jsonb_agg(to_jsonb(r) order by kind,name),'[]') from public.hq_resources r),
   'reservations',(select coalesce(jsonb_agg(to_jsonb(r) order by starts_at desc),'[]') from public.hq_reservations r where ends_at>now()-interval '1 year' or status='issued'),
   'materials',(select coalesce(jsonb_agg(to_jsonb(m) order by kind,name),'[]') from public.hq_materials m where not archived),
   'minutes',(select coalesce(jsonb_agg(hq_private.archive_json(d) order by held_at desc),'[]') from public.hq_minutes_archive d where hq_private.archive_editor(d.id) or (d.published_at is not null and uid=any(d.participant_ids))), 'serverTime',now());
 end if;
 if p_action='ai_access' then
  if p_body->>'meetingId' is not null then
   if not comm_private.document_editor((p_body->>'meetingId')::uuid) then raise exception 'Протокол готовит организатор или ответственный' using errcode='42501'; end if;
  elsif p_body->>'archiveId' is not null then
   if not hq_private.archive_editor((p_body->>'archiveId')::uuid) then raise exception 'Нет доступа к протоколу' using errcode='42501'; end if;
  else raise exception 'Сначала сохраните планёрку или выберите встречу'; end if;
  return jsonb_build_object('ok',true);
 end if;
 req:=(p_body->>'requestId')::uuid;
 if req is null then raise exception 'Нет номера запроса'; end if;
 perform pg_advisory_xact_lock(hashtextextended(req::text,0));
 select * into previous from hq_private.requests where id=req;
 payload:=jsonb_build_object('action',p_action,'body',p_body);
 if previous.id is not null then
  if previous.user_id<>uid or previous.body<>payload then raise exception 'Номер запроса уже использован'; end if;
  return previous.result;
 end if;
 rid:=coalesce(nullif(p_body->>'id','')::uuid,gen_random_uuid());
 if p_action='resource_save' then
  if not manager then raise exception 'Каталог ведёт штаб' using errcode='42501'; end if;
  if p_body->>'kind' not in ('room','equipment') then raise exception 'Выберите тип ресурса'; end if;
  if length(coalesce(p_body->>'description',''))>2000 or length(coalesce(p_body->>'code',''))>80 then raise exception 'Сократите описание или инвентарный номер'; end if;
  select * into resource from public.hq_resources where id=rid for update;
  if resource.id is not null and resource.kind<>p_body->>'kind' then raise exception 'Тип существующего ресурса менять нельзя'; end if;
  insert into public.hq_resources(id,kind,name,code,description,active,created_by)
   values(rid,p_body->>'kind',trim(p_body->>'name'),coalesce(p_body->>'code',''),coalesce(p_body->>'description',''),coalesce((p_body->>'active')::boolean,true),uid)
   on conflict(id) do update set name=excluded.name,code=excluded.code,description=excluded.description,active=excluded.active returning * into resource;
  result:=to_jsonb(resource);
 elsif p_action='reserve' then
  select * into resource from public.hq_resources where id=(p_body->>'resourceId')::uuid for update;
  if resource.id is null or not resource.active then raise exception 'Ресурс недоступен для брони'; end if;
  start_time:=(p_body->>'startsAt')::timestamptz; end_time:=(p_body->>'endsAt')::timestamptz;
  if start_time is null or end_time is null or not isfinite(start_time) or not isfinite(end_time) or start_time<now()-interval '5 minutes' or start_time>now()+interval '1 year' or end_time<=start_time or end_time>start_time+interval '90 days' then raise exception 'Проверьте начало и окончание брони (до 90 дней)'; end if;
  if exists(select 1 from public.hq_reservations where resource_id=resource.id and (status='issued' or status='reserved' and starts_at<end_time and ends_at>start_time)) then raise exception 'На это время уже есть бронь или оборудование ещё не возвращено. Выберите другое время.'; end if;
  insert into public.hq_reservations(id,resource_id,borrower_id,district_id,purpose,starts_at,ends_at,updated_by)
   values(rid,resource.id,uid,(select nullif(data->>'districtId','') from public.profiles where id=uid),trim(p_body->>'purpose'),start_time,end_time,uid) returning * into booking;
  for target in select id from public.profiles where data->>'role' in ('head','staff') and id<>uid loop
   perform hq_private.notify(target,'hq_booking_'||rid||'_'||target,'Новая бронь: '||resource.name||' · '||to_char(start_time at time zone 'Europe/Moscow','DD.MM HH24:MI')||' МСК','#/'||case when resource.kind='room' then 'headquarters' else 'equipment' end);
  end loop;
  result:=to_jsonb(booking);
 elsif p_action='reservation_update' then
  select r.* into resource from public.hq_resources r join public.hq_reservations b on b.resource_id=r.id where b.id=rid for update of r;
  select * into booking from public.hq_reservations where id=rid for update;
  if booking.id is null or not (manager or booking.borrower_id=uid) then raise exception 'Нет доступа к брони' using errcode='42501'; end if;
  if booking.version<>(p_body->>'version')::integer or p_body->>'version' is null then raise exception 'Бронь уже изменилась. Обновите список.'; end if;
  if p_body->>'status'='cancelled' and booking.status='reserved' then booking.status:='cancelled';
  elsif p_body->>'status'='issued' and booking.status='reserved' and resource.kind='equipment' then
   if not resource.active or booking.starts_at>now()+interval '30 minutes' or booking.ends_at<=now() then raise exception 'Получение доступно с 30 минут до начала и до окончания брони'; end if;
   if exists(select 1 from public.hq_reservations where resource_id=resource.id and id<>rid and (status='issued' or status='reserved' and starts_at<booking.ends_at and ends_at>now())) then raise exception 'Оборудование ещё у другого сотрудника или на это время действует его бронь'; end if;
   booking.status:='issued'; booking.issued_at:=now(); booking.issue_note:=coalesce(p_body->>'note','');
  elsif p_body->>'status'='returned' and booking.status='issued' and resource.kind='equipment' then
   booking.status:='returned'; booking.returned_at:=now(); booking.return_note:=coalesce(p_body->>'note','');
  else raise exception 'Это действие недоступно для текущего состояния брони'; end if;
  if length(booking.issue_note)>2000 or length(booking.return_note)>2000 then raise exception 'Комментарий — до 2000 символов'; end if;
  update public.hq_reservations set status=booking.status,issued_at=booking.issued_at,returned_at=booking.returned_at,issue_note=booking.issue_note,return_note=booking.return_note,updated_by=uid,version=version+1 where id=rid returning * into booking;
  for target in select id from public.profiles where (data->>'role' in ('head','staff') or id=booking.borrower_id) and id<>uid loop
   perform hq_private.notify(target,'hq_booking_'||rid||'_v'||booking.version||'_'||target,resource.name||': '||case booking.status when 'issued' then 'получено сотрудником' when 'returned' then 'возвращено' else 'бронь отменена' end,'#/'||case when resource.kind='room' then 'headquarters' else 'equipment' end);
  end loop;
  result:=to_jsonb(booking);
 elsif p_action='material_save' then
  if not manager then raise exception 'Материалы добавляет штаб' using errcode='42501'; end if;
  if p_body->>'kind' not in ('folder','link') then raise exception 'Выберите папку или ссылку'; end if;
  url:=trim(coalesce(p_body->>'url',''));
  if url<>'' and (url !~ '^https://[^/@[:space:]]+([/?#]|$)' or length(url)>2000) then raise exception 'Укажите безопасную ссылку https'; end if;
  if p_body->>'kind'='link' and url='' then raise exception 'Добавьте ссылку на материал'; end if;
  if length(coalesce(p_body->>'description',''))>2000 then raise exception 'Описание — до 2000 символов'; end if;
  if nullif(p_body->>'parentId','') is not null and not exists(select 1 from public.hq_materials where id=(p_body->>'parentId')::uuid and kind='folder' and not archived) then raise exception 'Папка не найдена'; end if;
  if exists(select 1 from public.hq_materials where id=rid) and (select parent_id::text from public.hq_materials where id=rid) is distinct from nullif(p_body->>'parentId','') then raise exception 'Для переноса создайте материал в нужной папке'; end if;
  if rid::text=p_body->>'parentId' then raise exception 'Папка не может содержать себя'; end if;
  insert into public.hq_materials(id,parent_id,kind,name,url,description,archived,updated_by)
   values(rid,nullif(p_body->>'parentId','')::uuid,p_body->>'kind',trim(p_body->>'name'),url,coalesce(p_body->>'description',''),coalesce((p_body->>'archived')::boolean,false),uid)
   on conflict(id) do update set name=excluded.name,url=excluded.url,description=excluded.description,archived=excluded.archived,updated_by=uid,updated_at=now() returning to_jsonb(hq_materials.*) into result;
 elsif p_action='minutes_save' then
  select * into doc from public.hq_minutes_archive where id=rid for update;
  if doc.id is not null and not hq_private.archive_editor(rid) then raise exception 'Нет доступа к протоколу' using errcode='42501'; end if;
  if doc.id is not null and (p_body->>'version' is null or doc.version<>(p_body->>'version')::integer) then raise exception 'Протокол изменён в другом окне. Обновите список.'; end if;
  if not exists(select 1 from public.profiles where id=(p_body->>'responsibleId')::uuid and data->>'role' in ('head','staff','coordinator') and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false)) then raise exception 'Выберите действующего ответственного'; end if;
  payload:=p_body->'content';
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Добавьте текст протокола'; end if;
  foreach k in array array['agenda','summary','decisions','actions'] loop
   if jsonb_typeof(payload->k) is distinct from 'string' or length(payload->>k)>8000 then raise exception 'Каждое поле протокола — текст до 8000 символов'; end if;
  end loop;
  payload:=jsonb_build_object('agenda',payload->>'agenda','summary',payload->>'summary','decisions',payload->>'decisions','actions',payload->>'actions');
  if jsonb_typeof(p_body->'attachments') is distinct from 'array' or jsonb_array_length(p_body->'attachments')>10 then raise exception 'Не больше 10 вложений'; end if;
  for item in select value from jsonb_array_elements(p_body->'attachments') loop
   if length(coalesce(item->>'name','')) not between 1 and 180 or (item->>'url' !~ '^sb://meeting-protocols/[a-f0-9-]{36}/' and item->>'url' !~ '^https://[^/@[:space:]]+([/?#]|$)') or item->>'url' is null then raise exception 'Проверьте файл или ссылку на протокол'; end if;
   if item->>'url' like 'sb://meeting-protocols/%' and not hq_private.protocol_read(substr(item->>'url',length('sb://meeting-protocols/')+1)) then raise exception 'Нет доступа к прикреплённому файлу' using errcode='42501'; end if;
  end loop;
  if jsonb_typeof(p_body->'participantIds') is distinct from 'array' then raise exception 'Выберите участников'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_body->'participantIds') x where not exists(select 1 from public.profiles where id=x::uuid and data->>'role' in ('head','staff','coordinator') and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false))) then raise exception 'В списке участников есть недоступная учётная запись'; end if;
  start_time:=(p_body->>'heldAt')::timestamptz;
  if start_time is null or not isfinite(start_time) then raise exception 'Укажите дату планёрки'; end if;
  insert into public.hq_minutes_archive(id,title,held_at,owner_id,responsible_id,content,attachments,participant_ids)
   values(rid,trim(p_body->>'title'),start_time,uid,(p_body->>'responsibleId')::uuid,payload,p_body->'attachments',array(select value::uuid from jsonb_array_elements_text(p_body->'participantIds')))
   on conflict(id) do update set title=excluded.title,held_at=excluded.held_at,responsible_id=excluded.responsible_id,content=excluded.content,attachments=excluded.attachments,participant_ids=excluded.participant_ids,version=hq_minutes_archive.version+1,updated_at=now() returning * into doc;
  result:=hq_private.archive_json(doc);
 elsif p_action='minutes_publish' then
  select * into doc from public.hq_minutes_archive where id=rid for update;
  if doc.id is null or not hq_private.archive_editor(rid) then raise exception 'Нет доступа к протоколу' using errcode='42501'; end if;
  if p_body->>'version' is null or doc.version<>(p_body->>'version')::integer then raise exception 'Протокол изменился. Обновите список.'; end if;
  if doc.published_version=doc.version then result:=hq_private.archive_json(doc);
  else
   if trim(concat_ws('',doc.content->>'summary',doc.content->>'decisions',doc.content->>'actions'))='' and jsonb_array_length(doc.attachments)=0 then raise exception 'Добавьте итоги или файл протокола'; end if;
   update public.hq_minutes_archive set published_content=content,published_attachments=attachments,published_version=version,published_at=now() where id=rid returning * into doc;
   for target in select distinct x from unnest(doc.participant_ids||array[doc.owner_id,doc.responsible_id]) x loop
    perform hq_private.notify(target,'hq_minutes_'||rid||'_v'||doc.version||'_'||target,'Протокол планёрки «'||doc.title||'» готов. Решения, поручения и файлы — в истории планёрок.','#/planning/'||rid,'meeting');
   end loop;
   result:=hq_private.archive_json(doc);
  end if;
 else raise exception 'Неизвестное действие'; end if;
 insert into hq_private.requests(id,user_id,body,result) values(req,uid,jsonb_build_object('action',p_action,'body',p_body),result);
 return result;
end $$;
create function public.headquarters(p_action text,p_body jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select hq_private.dispatch(p_action,p_body)$$;
revoke all on all functions in schema hq_private from public,anon,authenticated;
grant execute on function hq_private.active(),hq_private.manager(),hq_private.dispatch(text,jsonb) to authenticated;
revoke all on function public.headquarters(text,jsonb) from public,anon;
grant execute on function public.headquarters(text,jsonb) to authenticated;

-- Working access is restricted to HQ and district leadership. Historic profiles stay intact.
create or replace function public.my_role() returns text language sql stable security definer set search_path='' as $$
 select data->>'role' from public.profiles where id=auth.uid() and data->>'role' in ('head','staff','coordinator') and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false)
$$;
create or replace function comm_private.active() returns boolean language sql stable security definer set search_path='' as $$select hq_private.active()$$;
alter policy p_read on public.profiles using(id=(select auth.uid()) or (select hq_private.active()));
do $$declare t text;begin
 foreach t in array array['profiles','tasks','events','reports','districts','metrics','settings','notifications','audit_log','daily_reports','media_briefs','task_templates','task_schedules','media_matches'] loop
  if to_regclass('public.'||t) is not null then
   if t='profiles' then
    execute 'create policy hq_working_write on public.profiles as restrictive for update to authenticated using((select hq_private.active())) with check((select hq_private.active()))';
   else
    execute format('create policy hq_working_access on public.%I as restrictive for all to authenticated using((select hq_private.active())) with check((select hq_private.active()))',t);
   end if;
  end if;
 end loop;
end $$;

-- Bounded AI use; no transcript is stored in the job ledger.
create table hq_private.ai_jobs(id uuid primary key,user_id uuid not null,input_hash text not null,state text not null default 'running',result jsonb,created_at timestamptz not null default now());
create index hq_ai_user_time on hq_private.ai_jobs(user_id,created_at);
alter table hq_private.ai_jobs enable row level security;
revoke all on hq_private.ai_jobs from public,anon,authenticated;
create function hq_private.ai_claim(body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous hq_private.ai_jobs;uid uuid:=auth.uid();rid uuid:=(body->>'requestId')::uuid;
begin
 perform hq_private.dispatch('ai_access',body);
 perform pg_advisory_xact_lock(hashtextextended(uid::text,765));
 if rid is null or body->>'hash' !~ '^[a-f0-9]{64}$' then raise exception 'Некорректный запрос ИИ'; end if;
 select * into previous from hq_private.ai_jobs where id=rid;
 if previous.id is not null then
  if previous.user_id<>uid or previous.input_hash<>body->>'hash' then raise exception 'Номер запроса уже использован'; end if;
  if previous.state='complete' then return jsonb_build_object('content',previous.result); end if;
  return jsonb_build_object('busy',true);
 end if;
 if (select count(*) from hq_private.ai_jobs where user_id=uid and created_at>now()-interval '1 hour')>=10 then raise exception 'Лимит — 10 ИИ-протоколов в час. Попробуйте позже.'; end if;
 delete from hq_private.ai_jobs where created_at<now()-interval '7 days';
 insert into hq_private.ai_jobs(id,user_id,input_hash) values(rid,uid,body->>'hash');
 return jsonb_build_object('claimed',true);
end $$;
create function hq_private.ai_complete(p_id uuid,p_user uuid,p_result jsonb) returns void language sql security definer set search_path='' as $$
 update hq_private.ai_jobs set state=case when p_result is null then 'failed' else 'complete' end,result=p_result where id=p_id and user_id=p_user and state='running'
$$;
create function public.headquarters_ai_complete(p_id uuid,p_user uuid,p_result jsonb) returns void language sql security invoker set search_path='' as $$select hq_private.ai_complete(p_id,p_user,p_result)$$;
revoke all on function hq_private.ai_claim(jsonb),hq_private.ai_complete(uuid,uuid,jsonb),public.headquarters_ai_complete(uuid,uuid,jsonb) from public,anon,authenticated;
grant usage on schema hq_private to service_role;
grant execute on function hq_private.ai_complete(uuid,uuid,jsonb),public.headquarters_ai_complete(uuid,uuid,jsonb) to service_role;


-- Protocol files stay separate from ordinary task attachments; draft access follows document rights.
create function hq_private.protocol_read(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select hq_private.active() and (split_part(object_name,'/',1)=auth.uid()::text or hq_private.manager() or exists(
  select 1 from public.hq_minutes_archive d where
   (hq_private.archive_editor(d.id) and exists(select 1 from jsonb_array_elements(d.attachments) a where a->>'url'='sb://meeting-protocols/'||object_name))
   or (auth.uid()=any(d.participant_ids) and exists(select 1 from jsonb_array_elements(coalesce(d.published_attachments,'[]')) a where a->>'url'='sb://meeting-protocols/'||object_name))))
$$;
revoke all on function hq_private.protocol_read(text) from public,anon;
grant execute on function hq_private.protocol_read(text) to authenticated;
do $$begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit) values('meeting-protocols','meeting-protocols',false,10485760) on conflict(id) do nothing;
  create policy hq_protocol_upload on storage.objects for insert to authenticated with check(bucket_id='meeting-protocols' and hq_private.active() and split_part(name,'/',1)=auth.uid()::text);
  create policy hq_protocol_read on storage.objects for select to authenticated using(bucket_id='meeting-protocols' and hq_private.protocol_read(name));
 end if;
end $$;

create index hq_resource_creator on public.hq_resources(created_by) where created_by is not null;
create index hq_reservation_actor on public.hq_reservations(updated_by) where updated_by is not null;
create index hq_material_actor on public.hq_materials(updated_by) where updated_by is not null;
