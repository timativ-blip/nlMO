-- Drafts and delivery receipts are private; published revisions have recipient RLS.
create table comm_private.meeting_documents (
  meeting_id uuid primary key references public.comm_meetings(id) on delete cascade,
  responsible_id uuid references public.profiles(id),
  content jsonb not null default '{"agenda":"","summary":"","decisions":"","actions":""}',
  version integer not null default 0,
  updated_at timestamptz not null default now()
);
create index meeting_documents_responsible on comm_private.meeting_documents(responsible_id) where responsible_id is not null;
create table public.comm_meeting_minutes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.comm_meetings(id) on delete cascade,
  revision integer not null check(revision>0),
  draft_version integer not null,
  content jsonb not null,
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  unique(meeting_id,revision), unique(meeting_id,draft_version)
);
create index comm_minutes_publisher on public.comm_meeting_minutes(published_by);
create table comm_private.minutes_recipients (
  minutes_id uuid not null references public.comm_meeting_minutes(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  notified_at timestamptz not null default now(),
  primary key(minutes_id,user_id)
);
create index minutes_recipients_user on comm_private.minutes_recipients(user_id,minutes_id);
alter table comm_private.meeting_documents enable row level security;
alter table comm_private.minutes_recipients enable row level security;
alter table public.comm_meeting_minutes enable row level security;
revoke all on comm_private.meeting_documents,comm_private.minutes_recipients,public.comm_meeting_minutes from public,anon,authenticated,service_role;

create function comm_private.document_editor(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select comm_private.active())
    and not exists(select 1 from public.comm_participants where meeting_id=mid and user_id=(select auth.uid()) and state='removed')
    and (exists(select 1 from public.comm_meetings where id=mid and owner_id=(select auth.uid()))
      or exists(select 1 from comm_private.meeting_documents where meeting_id=mid and responsible_id=(select auth.uid())))
$$;
create function comm_private.read_minutes(doc uuid,mid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select comm_private.active())
    and not exists(select 1 from public.comm_participants where meeting_id=mid and user_id=(select auth.uid()) and state='removed')
    and (comm_private.document_editor(mid) or exists(select 1 from comm_private.minutes_recipients where minutes_id=doc and user_id=(select auth.uid())))
$$;
create policy comm_minutes_read on public.comm_meeting_minutes for select to authenticated using (comm_private.read_minutes(id,meeting_id));
grant select on public.comm_meeting_minutes to authenticated;

-- A delegated secretary can open the meeting before joining, including a private meeting.
create or replace function comm_private.sees_meeting(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select comm_private.active()) and not exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=(select auth.uid()) and p.state='removed') and (
    exists(select 1 from public.comm_meetings r where r.id=mid and (r.owner_id=(select auth.uid()) or (r.notify_all and not r.invite_only)))
    or exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=(select auth.uid()))
    or exists(select 1 from public.comm_invitations i where i.meeting_id=mid and (i.user_id=(select auth.uid()) or i.inviter_id=(select auth.uid())))
    or exists(select 1 from comm_private.meeting_documents d where d.meeting_id=mid and d.responsible_id=(select auth.uid())))
$$;

create function comm_private.documents_json(mid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.comm_meetings; d comm_private.meeting_documents; pub public.comm_meeting_minutes; editable boolean;
begin
  if not comm_private.active() then raise exception 'Войдите в активную учётную запись' using errcode='42501'; end if;
  select * into r from public.comm_meetings where id=mid;
  if r.id is null or (r.invite_only and not comm_private.sees_meeting(mid)) or exists(select 1 from public.comm_participants where meeting_id=mid and user_id=auth.uid() and state='removed') then raise exception 'Нет доступа к документам встречи' using errcode='42501'; end if;
  editable:=comm_private.document_editor(mid);
  select * into d from comm_private.meeting_documents where meeting_id=mid;
  select * into pub from public.comm_meeting_minutes m where meeting_id=mid and comm_private.read_minutes(m.id,mid) order by revision desc limit 1;
  return jsonb_build_object('meetingId',mid,'title',r.title,'ownerId',r.owner_id,'responsibleId',coalesce(d.responsible_id,r.owner_id),'canEdit',editable,
    'agenda',coalesce(d.content->>'agenda',''),
    'draft',case when editable then jsonb_build_object('content',coalesce(d.content,'{"agenda":"","summary":"","decisions":"","actions":""}'::jsonb),'version',coalesce(d.version,0),'updatedAt',d.updated_at) else null end,
    'published',case when pub.id is not null then jsonb_build_object('id',pub.id,'revision',pub.revision,'draftVersion',pub.draft_version,'content',pub.content,'publishedAt',pub.published_at,'publishedBy',pub.published_by,'recipients',(select count(*) from comm_private.minutes_recipients where minutes_id=pub.id)) else null end,
    'eligibleRecipients',case when editable then (select count(*) from public.profiles p where coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)
      and not exists(select 1 from public.comm_participants cp where cp.meeting_id=mid and cp.user_id=p.id and cp.state='removed')
      and (p.id in(r.owner_id,coalesce(d.responsible_id,r.owner_id)) or exists(select 1 from public.comm_participants cp where cp.meeting_id=mid and cp.user_id=p.id and cp.joined_at is not null))) else null end);
end $$;

create function comm_private.deliver_minutes(doc uuid,target uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.comm_meeting_minutes; r public.comm_meetings; full_text text; message text; nid text;
begin
  select * into m from public.comm_meeting_minutes where id=doc;
  select * into r from public.comm_meetings where id=m.meeting_id;
  if r.id is null or not exists(select 1 from public.profiles where id=target and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false))
    or exists(select 1 from public.comm_participants where meeting_id=r.id and user_id=target and state='removed')
    or not (target=r.owner_id or exists(select 1 from comm_private.meeting_documents where meeting_id=r.id and responsible_id=target) or exists(select 1 from public.comm_participants where meeting_id=r.id and user_id=target and joined_at is not null)) then return; end if;
  insert into comm_private.minutes_recipients(minutes_id,user_id) values(doc,target) on conflict do nothing;
  if not found then return; end if;
  full_text:='Протокол встречи «'||r.title||'» · версия '||m.revision||E'\n'
    ||concat_ws(E'\n\n',case when m.content->>'agenda'<>'' then 'Повестка:'||E'\n'||(m.content->>'agenda') end,
      case when m.content->>'summary'<>'' then 'Итоги:'||E'\n'||(m.content->>'summary') end,
      case when m.content->>'decisions'<>'' then 'Решения:'||E'\n'||(m.content->>'decisions') end,
      case when m.content->>'actions'<>'' then 'Поручения и сроки:'||E'\n'||(m.content->>'actions') end);
  message:=case when char_length(full_text)>1750 then left(full_text,1750)||E'\n…\nПолный протокол — по кнопке «Открыть в приложении».' else full_text end;
  nid:='minutes_'||doc::text||'_'||target::text;
  insert into public.notifications(id,user_id,data) values(nid,target,jsonb_build_object('id',nid,'userId',target,'text',message,'at',now(),'read',false,'link','#/meetings/'||r.id::text||'/minutes','kind','meeting'));
end $$;

-- A participant who joins after publication receives the current revision once.
create function comm_private.minutes_after_join() returns trigger language plpgsql security definer set search_path='' as $$
declare doc uuid;
begin
  if new.joined_at is not null and new.state='joined' then
    -- Same lock as publication prevents a first join racing the recipient snapshot.
    perform 1 from public.comm_meetings where id=new.meeting_id for update;
    select id into doc from public.comm_meeting_minutes where meeting_id=new.meeting_id order by revision desc limit 1;
    if doc is not null then perform comm_private.deliver_minutes(doc,new.user_id); end if;
  end if;
  return new;
end $$;
create trigger comm_minutes_after_join after insert or update of joined_at,state on public.comm_participants for each row execute function comm_private.minutes_after_join();

-- Take the meeting lock before media updates a participant (the same order as moderation).
alter function comm_private.media_dispatch(text,jsonb) rename to media_dispatch_v2;
create function comm_private.media_dispatch(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_action='event' then perform 1 from public.comm_meetings where id=(p_body->>'meetingId')::uuid for update; end if;
  return comm_private.media_dispatch_v2(p_action,p_body);
end $$;
create or replace function public.communications_media(p_action text,p_body jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select comm_private.media_dispatch(p_action,p_body)$$;
revoke all on function comm_private.media_dispatch_v2(text,jsonb),comm_private.media_dispatch(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function comm_private.media_dispatch(text,jsonb) to service_role;

alter function comm_private.dispatch(text,jsonb) rename to dispatch_v2;
create function comm_private.dispatch(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); mid uuid; rid uuid; r public.comm_meetings; d comm_private.meeting_documents; saved comm_private.requests; m public.comm_meeting_minutes; target uuid; nid text; result jsonb; value jsonb; key text; next_content jsonb:='{}'; expected integer;
begin
  if p_action not in ('minutes','minutes_save','minutes_assign','minutes_publish') then return comm_private.dispatch_v2(p_action,p_body); end if;
  if not comm_private.active() then raise exception 'Войдите в активную учётную запись' using errcode='42501'; end if;
  if jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>131072 then raise exception 'Некорректный запрос'; end if;
  mid:=(p_body->>'meetingId')::uuid;
  if p_action='minutes' then return comm_private.documents_json(mid); end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,73491));
  select * into r from public.comm_meetings where id=mid for update;
  if r.id is null or not comm_private.document_editor(mid) then raise exception 'Редактирование доступно организатору и ответственному' using errcode='42501'; end if;
  if p_action='minutes_assign' and actor<>r.owner_id then raise exception 'Ответственного назначает организатор' using errcode='42501'; end if;
  rid:=(p_body->>'requestId')::uuid;
  if rid is null then raise exception 'Нет идентификатора запроса'; end if;
  select * into saved from comm_private.requests where user_id=actor and request_id=rid;
  if saved.request_id is not null then
    if saved.action<>p_action or saved.body_hash<>md5(p_body::text) then raise exception 'Идентификатор запроса уже использован'; end if;
    return saved.result;
  end if;
  if (select count(*) from comm_private.requests where user_id=actor and created_at>now()-interval '1 minute')>=100 then raise exception 'Слишком много действий. Подождите минуту'; end if;
  insert into comm_private.meeting_documents(meeting_id) values(mid) on conflict do nothing;
  select * into d from comm_private.meeting_documents where meeting_id=mid for update;
  if p_action='minutes_assign' then
    target:=nullif(p_body->>'responsibleId','')::uuid;
    if target is null or not exists(select 1 from public.profiles where id=target and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false)) or exists(select 1 from public.comm_participants where meeting_id=mid and user_id=target and state='removed') then raise exception 'Выберите активного сотрудника'; end if;
    if target<>coalesce(d.responsible_id,r.owner_id) then
      if (select count(*) from comm_private.requests where user_id=actor and action='minutes_assign' and created_at>now()-interval '1 hour')>=20 then raise exception 'Слишком много назначений. Повторите позже'; end if;
      update comm_private.meeting_documents set responsible_id=target where meeting_id=mid;
      if r.invite_only and r.ended_at is null and r.expires_at>now() and target<>actor then perform comm_private.invite(mid,array[target]); end if;
      nid:='minutes_assignment_'||rid::text;
      insert into public.notifications(id,user_id,data) values(nid,target,jsonb_build_object('id',nid,'userId',target,'text','Вы назначены ответственным за повестку и протокол встречи «'||r.title||'»','at',now(),'read',false,'link','#/meetings/'||mid::text||'/minutes','kind','meeting'));
    end if;
  else
    expected:=(p_body->>'expectedVersion')::integer;
    if expected is null or expected<>d.version then raise exception 'Черновик изменён в другом окне. Скопируйте свои правки и обновите документ' using errcode='40001'; end if;
    if p_action='minutes_save' then
      foreach key in array array['agenda','summary','decisions','actions'] loop
        value:=p_body->key;
        if jsonb_typeof(value) is distinct from 'string' or char_length(value#>>'{}')>8000 then raise exception 'Каждое поле должно содержать текст до 8000 символов'; end if;
        next_content:=next_content||jsonb_build_object(key,btrim(value#>>'{}'));
      end loop;
      if next_content<>d.content then update comm_private.meeting_documents set content=next_content,version=version+1,updated_at=now() where meeting_id=mid; end if;
    else
      if coalesce(d.content->>'summary','')='' and coalesce(d.content->>'decisions','')='' and coalesce(d.content->>'actions','')='' then raise exception 'Заполните итоги, решения или поручения'; end if;
      select * into m from public.comm_meeting_minutes where meeting_id=mid and draft_version=d.version;
      if m.id is null then
        if (select count(*) from comm_private.requests where user_id=actor and action='minutes_publish' and created_at>now()-interval '1 hour')>=10 then raise exception 'Слишком много отправок протокола. Повторите позже'; end if;
        insert into public.comm_meeting_minutes(meeting_id,revision,draft_version,content,published_by)
          values(mid,(select coalesce(max(revision),0)+1 from public.comm_meeting_minutes where meeting_id=mid),d.version,d.content,actor) returning * into m;
        for target in select id from public.profiles where id=r.owner_id or id=coalesce(d.responsible_id,r.owner_id) or id in(select user_id from public.comm_participants where meeting_id=mid and joined_at is not null)
        loop perform comm_private.deliver_minutes(m.id,target); end loop;
      end if;
    end if;
  end if;
  result:=comm_private.documents_json(mid);
  insert into comm_private.requests(user_id,request_id,action,body_hash,result) values(actor,rid,p_action,md5(p_body::text),result);
  return result;
end $$;
create or replace function public.communications(p_action text,p_body jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select comm_private.dispatch(p_action,coalesce(p_body,'{}'))$$;
revoke all on function comm_private.document_editor(uuid),comm_private.read_minutes(uuid,uuid),comm_private.documents_json(uuid),comm_private.deliver_minutes(uuid,uuid),comm_private.minutes_after_join(),comm_private.dispatch_v2(text,jsonb),comm_private.dispatch(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function comm_private.document_editor(uuid),comm_private.read_minutes(uuid,uuid),comm_private.dispatch(text,jsonb) to authenticated;
do $$begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.comm_meeting_minutes;
  end if;
end $$;
