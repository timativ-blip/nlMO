-- Extend the installed communications module without rewriting messages or existing meetings.
alter table public.comm_meetings
  add column scheduled_at timestamptz,
  add column notify_all boolean not null default false,
  add column schedule_revision integer not null default 0,
  add column schedule_updated_at timestamptz;
create index comm_meetings_schedule on public.comm_meetings(scheduled_at) where ended_at is null and scheduled_at is not null;

-- One committed batch per meeting/revision/event; notification inserts and this receipt are atomic.
create table comm_private.meeting_notices (
  meeting_id uuid not null references public.comm_meetings(id) on delete cascade,
  revision integer not null,
  kind text not null check(kind in ('created','broadcast','rescheduled','reminder','starting','ended','cancelled')),
  created_at timestamptz not null default now(),
  primary key(meeting_id,revision,kind)
);
alter table comm_private.meeting_notices enable row level security;
revoke all on comm_private.meeting_notices from public,anon,authenticated,service_role;

create or replace function comm_private.meeting_json(r public.comm_meetings) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',r.id,'ownerId',r.owner_id,'title',r.title,'inviteOnly',r.invite_only,'locked',r.locked,'createdAt',r.created_at,'scheduledAt',r.scheduled_at,'startsAt',coalesce(r.scheduled_at,r.created_at),'notifyAll',r.notify_all,'expiresAt',r.expires_at,'endedAt',r.ended_at,'active',r.ended_at is null and r.expires_at>now(),'canJoin',r.ended_at is null and r.expires_at>now() and (r.scheduled_at is null or r.scheduled_at<=now()),'phase',case when r.ended_at is not null and r.scheduled_at>r.ended_at then 'cancelled' when r.ended_at is not null or r.expires_at<=now() then 'ended' when r.scheduled_at>now() then 'scheduled' else 'live' end)
$$;
create or replace function comm_private.sees_meeting(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select comm_private.active()) and not exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=(select auth.uid()) and p.state='removed') and (exists(select 1 from public.comm_meetings r where r.id=mid and (r.owner_id=(select auth.uid()) or (r.notify_all and not r.invite_only))) or exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=(select auth.uid())) or exists(select 1 from public.comm_invitations i where i.meeting_id=mid and (i.user_id=(select auth.uid()) or i.inviter_id=(select auth.uid()))))
$$;
create or replace function comm_private.in_room(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select comm_private.active()) and exists(select 1 from public.comm_participants p join public.comm_meetings r on r.id=p.meeting_id where p.meeting_id=mid and p.user_id=(select auth.uid()) and p.state='joined' and r.ended_at is null and r.expires_at>now() and (r.scheduled_at is null or r.scheduled_at<=now()))
$$;

create function comm_private.meeting_notice(mid uuid,notice text) returns integer language plpgsql security definer set search_path='' as $$
declare r public.comm_meetings; target uuid; label text; content text; when_label text; nid text; sent integer:=0;
begin
  select * into r from public.comm_meetings where id=mid for update;
  if r.id is null then return 0; end if;
  insert into comm_private.meeting_notices(meeting_id,revision,kind) values(mid,r.schedule_revision,notice) on conflict do nothing;
  if not found then return 0; end if;
  select data->>'name' into label from public.profiles where id=r.owner_id;
  when_label:=to_char(coalesce(r.scheduled_at,r.created_at) at time zone 'Europe/Moscow','DD.MM.YYYY "в" HH24:MI')||' МСК';
  content:=case notice
    when 'created' then case when r.scheduled_at is not null then 'Запланирована встреча' else 'Новая встреча' end||' «'||r.title||'» — '||when_label||'. Организатор: '||coalesce(label,'Сотрудник')
    when 'broadcast' then 'Встреча для всей команды «'||r.title||'» — '||when_label||'. Организатор: '||coalesce(label,'Сотрудник')
    when 'rescheduled' then 'Встреча «'||r.title||'» перенесена на '||when_label
    when 'reminder' then 'Скоро встреча «'||r.title||'» — '||when_label
    when 'starting' then 'Пора подключаться к встрече «'||r.title||'» — '||when_label
    when 'cancelled' then 'Встреча «'||r.title||'» отменена. Была назначена на '||when_label
    when 'ended' then 'Встреча «'||r.title||'» завершена'
  end;
  for target in
    select p.id from public.profiles p
    where coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)
      and not exists(select 1 from public.comm_participants cp where cp.meeting_id=mid and cp.user_id=p.id and cp.state='removed')
      and ((r.notify_all and not r.invite_only) or p.id=r.owner_id or exists(select 1 from public.comm_invitations i where i.meeting_id=mid and (i.user_id=p.id or i.inviter_id=p.id) and (notice in ('cancelled','ended','rescheduled') or i.status in ('pending','accepted','joined'))) or exists(select 1 from public.comm_participants cp where cp.meeting_id=mid and cp.user_id=p.id))
  loop
    nid:='meeting_notice_'||gen_random_uuid()::text;
    insert into public.notifications(id,user_id,data) values(nid,target,jsonb_build_object('id',nid,'userId',target,'text',content,'at',now(),'read',false,'link','#/meetings/'||mid::text,'kind','meeting'));
    sent:=sent+1;
  end loop;
  return sent;
end $$;

-- Reuse the established invitation and privacy rules, with an expiry that covers a future meeting.
create or replace function comm_private.invite(mid uuid,targets uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target uuid; r public.comm_meetings; i public.comm_invitations; result jsonb:='[]'; nid text; label text; until_at timestamptz;
begin
  select * into r from public.comm_meetings where id=mid for update;
  if not comm_private.active() or r.id is null or r.ended_at is not null or r.expires_at<=now() or (r.owner_id<>actor and not comm_private.in_room(mid)) then raise exception 'Нет права приглашать в эту встречу' using errcode='42501'; end if;
  if r.locked then raise exception 'Вход во встречу закрыт'; end if;
  if coalesce(cardinality(targets),0) not between 1 and 20 or cardinality(targets)<>(select count(distinct t) from unnest(targets) t) then raise exception 'Выберите от 1 до 20 разных сотрудников'; end if;
  select data->>'name' into label from public.profiles where id=actor;
  until_at:=case when r.scheduled_at is not null then r.expires_at else now()+interval '15 minutes' end;
  foreach target in array targets loop
    if target=actor or not exists(select 1 from public.profiles p where p.id=target and coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)) then raise exception 'Сотрудник недоступен'; end if;
    if exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=target and p.state='removed') then raise exception 'Удалённого участника нельзя пригласить повторно'; end if;
    select * into i from public.comm_invitations where meeting_id=mid and user_id=target;
    if i.id is not null and i.status in ('pending','accepted','joined') and i.expires_at>now() then result:=result||jsonb_build_array(comm_private.invitation_json(i)); continue; end if;
    if i.id is not null and i.updated_at>now()-interval '60 seconds' then raise exception 'Повторное приглашение доступно через минуту'; end if;
    if exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=target and p.state='joined') then continue; end if;
    nid:='meeting_'||gen_random_uuid()::text;
    insert into public.comm_invitations(meeting_id,inviter_id,user_id,notification_id,expires_at) values(mid,actor,target,nid,until_at)
      on conflict(meeting_id,user_id) do update set inviter_id=actor,status='pending',updated_at=now(),expires_at=until_at,notification_id=nid returning * into i;
    insert into public.notifications(id,user_id,data) values(nid,target,jsonb_build_object('id',nid,'userId',target,'text',label||' приглашает во встречу «'||r.title||'»'||case when r.scheduled_at is not null then ' — '||to_char(r.scheduled_at at time zone 'Europe/Moscow','DD.MM.YYYY "в" HH24:MI')||' МСК' else '' end,'at',now(),'read',false,'link','#/meetings/'||mid::text,'kind','meeting'));
    result:=result||jsonb_build_array(comm_private.invitation_json(i));
  end loop;
  return result;
end $$;

alter function comm_private.dispatch(text,jsonb) rename to dispatch_v1;
create function comm_private.dispatch(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<dispatch_block>>
declare actor uuid:=auth.uid(); rid uuid; mid uuid; scheduled timestamptz; all_team boolean; r public.comm_meetings; saved comm_private.requests; result jsonb;
begin
  if not comm_private.active() then raise exception 'Войдите в активную учётную запись' using errcode='42501'; end if;
  if p_action in ('create','schedule','announce') then
    if jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>65536 then raise exception 'Некорректный запрос'; end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text,73491));
    rid:=(p_body->>'requestId')::uuid;
    if rid is null then raise exception 'Нет идентификатора запроса'; end if;
    select * into saved from comm_private.requests where user_id=actor and request_id=rid;
    if saved.request_id is not null then
      if saved.action<>p_action or saved.body_hash<>md5(p_body::text) then raise exception 'Идентификатор запроса уже использован'; end if;
      return saved.result;
    end if;
    if p_action='announce' then
      mid:=(p_body->>'meetingId')::uuid; select * into r from public.comm_meetings where id=mid for update;
      if r.id is null or r.owner_id<>actor then raise exception 'Уведомить команду может только организатор' using errcode='42501'; end if;
      if r.invite_only or r.ended_at is not null or r.expires_at<=now() then raise exception 'Для этой встречи общее уведомление недоступно'; end if;
      if (select count(*) from comm_private.requests where user_id=actor and created_at>now()-interval '1 minute')>=100 then raise exception 'Слишком много действий. Подождите минуту'; end if;
      if (select count(*) from comm_private.requests where user_id=actor and action='announce' and created_at>now()-interval '1 hour')>=10 then raise exception 'Слишком много общих оповещений. Повторите позже'; end if;
      if not r.notify_all then
        update public.comm_meetings set notify_all=true where id=mid returning * into r;
        perform comm_private.meeting_notice(mid,'broadcast');
      end if;
      result:=comm_private.meeting_json(r);
      insert into comm_private.requests(user_id,request_id,action,body_hash,result) values(actor,rid,p_action,md5(p_body::text),result);
      return result;
    end if;
    scheduled:=nullif(p_body->>'scheduledAt','')::timestamptz;
    if scheduled is not null and (scheduled<=now() or scheduled>now()+interval '1 year') then raise exception 'Выберите будущее время в пределах года'; end if;
    if p_action='create' then
      all_team:=coalesce((p_body->>'notifyAll')::boolean,false);
      if all_team and (coalesce((p_body->>'inviteOnly')::boolean,false) or nullif(p_body->>'peerId','') is not null) then raise exception 'Для личной встречи выберите приглашения, а не всю команду'; end if;
      result:=comm_private.dispatch_v1(p_action,p_body); mid:=(result->'meeting'->>'id')::uuid;
      update public.comm_meetings set scheduled_at=scheduled,notify_all=all_team,schedule_updated_at=now(),expires_at=coalesce(scheduled,created_at)+interval '8 hours' where id=mid returning * into r;
      result:=jsonb_set(result,'{meeting}',comm_private.meeting_json(r));
      update comm_private.requests set result=dispatch_block.result where user_id=actor and request_id=rid;
      if scheduled is not null or all_team then perform comm_private.meeting_notice(mid,'created'); end if;
      return result;
    end if;
    mid:=(p_body->>'meetingId')::uuid; select * into r from public.comm_meetings where id=mid for update;
    if r.id is null or r.owner_id<>actor then raise exception 'Изменить время может только организатор' using errcode='42501'; end if;
    if scheduled is null or r.scheduled_at is null or r.scheduled_at<=now() or r.ended_at is not null or exists(select 1 from public.comm_participants where meeting_id=mid and joined_at is not null) then raise exception 'Изменить время можно у предстоящей встречи'; end if;
    if (select count(*) from comm_private.requests where user_id=actor and created_at>now()-interval '1 minute')>=100 or (select count(*) from comm_private.requests where user_id=actor and action='schedule' and created_at>now()-interval '1 hour')>=20 then raise exception 'Слишком много изменений времени. Повторите позже'; end if;
    update public.comm_meetings set scheduled_at=scheduled,expires_at=scheduled+interval '8 hours',schedule_revision=schedule_revision+1,schedule_updated_at=now() where id=mid returning * into r;
    update public.comm_invitations set expires_at=r.expires_at,updated_at=now() where meeting_id=mid and status in ('pending','accepted');
    result:=comm_private.meeting_json(r);
    insert into comm_private.requests(user_id,request_id,action,body_hash,result) values(actor,rid,p_action,md5(p_body::text),result);
    perform comm_private.meeting_notice(mid,'rescheduled');
    return result;
  end if;
  if p_action='admit' then
    select * into r from public.comm_meetings where id=(p_body->>'meetingId')::uuid;
    if r.ended_at is null and r.scheduled_at>now() and (not r.invite_only or comm_private.sees_meeting(r.id)) then raise exception 'Подключение откроется % МСК',to_char(r.scheduled_at at time zone 'Europe/Moscow','DD.MM.YYYY "в" HH24:MI') using errcode='42501'; end if;
  end if;
  result:=comm_private.dispatch_v1(p_action,p_body);
  if p_action='control' and p_body->>'action'='end' then
    mid:=(p_body->>'meetingId')::uuid; select * into r from public.comm_meetings where id=mid;
    perform comm_private.meeting_notice(mid,case when r.scheduled_at>r.ended_at then 'cancelled' else 'ended' end);
  end if;
  return result;
end $$;

alter function comm_private.media_dispatch(text,jsonb) rename to media_dispatch_v1;
create function comm_private.media_dispatch(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_action in ('admission','presence','event') and exists(select 1 from public.comm_meetings where id=(p_body->>'meetingId')::uuid and scheduled_at>now()) then
    if p_action='event' then return jsonb_build_object('remove',true); end if;
    raise exception 'Время подключения к встрече ещё не наступило' using errcode='42501';
  end if;
  return comm_private.media_dispatch_v1(p_action,p_body);
end $$;

alter function comm_private.cleanup() rename to cleanup_v1;
create function comm_private.cleanup() returns void language plpgsql security definer set search_path='' as $$
declare r public.comm_meetings; notice text;
begin
  perform comm_private.cleanup_v1();
  for r in
    select m.* from public.comm_meetings m where (m.scheduled_at is not null or m.notify_all) and (
      (m.ended_at is not null and not exists(select 1 from comm_private.meeting_notices n where n.meeting_id=m.id and n.revision=m.schedule_revision and n.kind in ('ended','cancelled')))
      or (m.ended_at is null and m.scheduled_at>now() and m.scheduled_at<=now()+interval '15 minutes' and m.schedule_updated_at<=m.scheduled_at-interval '15 minutes' and not exists(select 1 from comm_private.meeting_notices n where n.meeting_id=m.id and n.revision=m.schedule_revision and n.kind='reminder'))
      or (m.ended_at is null and m.scheduled_at<=now() and m.expires_at>now() and not exists(select 1 from comm_private.meeting_notices n where n.meeting_id=m.id and n.revision=m.schedule_revision and n.kind='starting'))
    ) order by coalesce(m.ended_at,m.scheduled_at,m.created_at) limit 100 for update skip locked
  loop
    notice:=case when r.ended_at is not null then case when r.scheduled_at>r.ended_at then 'cancelled' else 'ended' end when r.scheduled_at<=now() then 'starting' else 'reminder' end;
    perform comm_private.meeting_notice(r.id,notice);
  end loop;
end $$;

-- Rebind the public invokers after renaming the internal implementation.
create or replace function public.communications(p_action text,p_body jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select comm_private.dispatch(p_action,coalesce(p_body,'{}'))$$;
create or replace function public.communications_media(p_action text,p_body jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select comm_private.media_dispatch(p_action,p_body)$$;
revoke all on function comm_private.dispatch_v1(text,jsonb),comm_private.media_dispatch_v1(text,jsonb),comm_private.cleanup_v1(),comm_private.meeting_notice(uuid,text),comm_private.dispatch(text,jsonb),comm_private.media_dispatch(text,jsonb),comm_private.cleanup() from public,anon,authenticated,service_role;
grant execute on function comm_private.dispatch(text,jsonb) to authenticated;
grant execute on function comm_private.media_dispatch(text,jsonb),comm_private.cleanup() to service_role;
