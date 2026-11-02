-- Additive communication modules. Existing business tables and their policies are unchanged.
create schema if not exists comm_private;
revoke all on schema comm_private from public,anon,authenticated;
grant usage on schema comm_private to authenticated,service_role;

create table public.comm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id),
  user_b uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check(user_a<user_b), unique(user_a,user_b)
);
create index comm_conversations_b on public.comm_conversations(user_b);
create table public.comm_members (
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  open_until timestamptz, typing_until timestamptz, notification_id text,
  primary key(conversation_id,user_id)
);
create index comm_members_user on public.comm_members(user_id,conversation_id);
create table public.comm_meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  title text not null check(length(btrim(title)) between 3 and 120),
  invite_only boolean not null default false,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '8 hours',
  ended_at timestamptz
);
create index comm_meetings_owner on public.comm_meetings(owner_id,created_at desc);
create table public.comm_messages (
  id uuid primary key,
  seq bigint generated always as identity unique,
  conversation_id uuid not null references public.comm_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  text text not null default '' check(length(text)<=4000),
  meeting_id uuid references public.comm_meetings(id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz, read_at timestamptz,
  check(length(btrim(text))>0 or meeting_id is not null)
);
create index comm_messages_page on public.comm_messages(conversation_id,seq desc);
create index comm_messages_unread on public.comm_messages(conversation_id,sender_id) where read_at is null;
create index comm_messages_sender on public.comm_messages(sender_id,created_at desc);
create index comm_messages_meeting on public.comm_messages(meeting_id) where meeting_id is not null;
create table public.comm_participants (
  meeting_id uuid not null references public.comm_meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  media_identity uuid not null default gen_random_uuid(),
  state text not null default 'admitted' check(state in ('admitted','joined','left','removed')),
  joined_at timestamptz, media_sid text, media_updated_at timestamptz,
  primary key(meeting_id,user_id), unique(media_identity)
);
create index comm_participants_user on public.comm_participants(user_id,meeting_id);
create table public.comm_invitations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.comm_meetings(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id),
  user_id uuid not null references public.profiles(id),
  status text not null default 'pending' check(status in ('pending','accepted','joined','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes',
  notification_id text,
  unique(meeting_id,user_id), check(inviter_id<>user_id)
);
create index comm_invitations_user on public.comm_invitations(user_id,updated_at desc);
create index comm_invitations_inviter on public.comm_invitations(inviter_id,updated_at desc);
create table public.comm_room_messages (
  id uuid primary key,
  seq bigint generated always as identity unique,
  meeting_id uuid not null references public.comm_meetings(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  text text not null check(length(btrim(text)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index comm_room_messages_page on public.comm_room_messages(meeting_id,seq desc);
create index comm_room_messages_sender on public.comm_room_messages(sender_id,created_at desc);
create table comm_private.requests (
  user_id uuid not null references public.profiles(id), request_id uuid not null,
  action text not null, body_hash text not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(user_id,request_id)
);
create index comm_requests_rate on comm_private.requests(user_id,action,created_at desc);
create table comm_private.grants (
  id uuid primary key, meeting_id uuid not null references public.comm_meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id), request_id uuid not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '90 seconds', revoked_at timestamptz,
  unique(user_id,request_id)
);
create index comm_grants_room_user on comm_private.grants(meeting_id,user_id,created_at desc);
create table comm_private.controls (
  id uuid primary key, meeting_id uuid not null references public.comm_meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  action text not null check(action in ('end','lock','unlock','remove','mute')),
  target_id uuid references public.profiles(id),
  identities uuid[] not null default '{}',
  created_at timestamptz not null default now(), applied_at timestamptz
);
create index comm_controls_pending on comm_private.controls(meeting_id,created_at) where applied_at is null;
create index comm_controls_user on comm_private.controls(user_id,created_at);
create index comm_controls_target on comm_private.controls(target_id) where target_id is not null;
create table comm_private.webhooks(id text primary key, created_at timestamptz not null default now());

create function comm_private.active() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid() and coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false))
$$;
create function comm_private.member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select comm_private.active()) and exists(select 1 from public.comm_members m where m.conversation_id=cid and m.user_id=(select auth.uid()))
$$;
create function comm_private.sees_meeting(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select comm_private.active()) and not exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=(select auth.uid()) and p.state='removed') and (exists(select 1 from public.comm_meetings r where r.id=mid and r.owner_id=(select auth.uid())) or exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=(select auth.uid())) or exists(select 1 from public.comm_invitations i where i.meeting_id=mid and (i.user_id=(select auth.uid()) or i.inviter_id=(select auth.uid()))))
$$;
create function comm_private.in_room(mid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select comm_private.active()) and exists(select 1 from public.comm_participants p join public.comm_meetings r on r.id=p.meeting_id where p.meeting_id=mid and p.user_id=(select auth.uid()) and p.state='joined' and r.ended_at is null and r.expires_at>now())
$$;

alter table public.comm_conversations enable row level security;
alter table public.comm_members enable row level security;
alter table public.comm_messages enable row level security;
alter table public.comm_meetings enable row level security;
alter table public.comm_invitations enable row level security;
alter table public.comm_participants enable row level security;
alter table public.comm_room_messages enable row level security;
alter table comm_private.requests enable row level security;
alter table comm_private.grants enable row level security;
alter table comm_private.controls enable row level security;
alter table comm_private.webhooks enable row level security;
create policy comm_conversations_read on public.comm_conversations for select to authenticated using (comm_private.member(id));
create policy comm_members_read on public.comm_members for select to authenticated using (comm_private.member(conversation_id));
create policy comm_messages_read on public.comm_messages for select to authenticated using (comm_private.member(conversation_id));
create policy comm_meetings_read on public.comm_meetings for select to authenticated using (comm_private.sees_meeting(id));
create policy comm_invitations_read on public.comm_invitations for select to authenticated using ((select comm_private.active()) and (user_id=(select auth.uid()) or inviter_id=(select auth.uid()) or exists(select 1 from public.comm_meetings r where r.id=meeting_id and r.owner_id=(select auth.uid()))));
create policy comm_participants_read on public.comm_participants for select to authenticated using (((select comm_private.active()) and user_id=(select auth.uid())) or comm_private.sees_meeting(meeting_id));
create policy comm_room_messages_read on public.comm_room_messages for select to authenticated using (comm_private.in_room(meeting_id));
revoke all on public.comm_conversations,public.comm_members,public.comm_messages,public.comm_meetings,public.comm_invitations,public.comm_participants,public.comm_room_messages from public,anon,authenticated;
grant select on public.comm_conversations,public.comm_members,public.comm_messages,public.comm_meetings,public.comm_invitations,public.comm_participants,public.comm_room_messages to authenticated;
revoke all on all tables in schema comm_private from public,anon,authenticated;
revoke all on sequence public.comm_messages_seq_seq,public.comm_room_messages_seq_seq from public,anon,authenticated;

create function comm_private.message_json(m public.comm_messages) returns jsonb language sql immutable set search_path='' as $$
  select case when m.id is null then null else jsonb_build_object('id',m.id,'seq',m.seq::text,'conversationId',m.conversation_id,'senderId',m.sender_id,'text',m.text,'meetingId',m.meeting_id,'createdAt',m.created_at,'deliveredAt',m.delivered_at,'readAt',m.read_at) end
$$;
create function comm_private.meeting_json(r public.comm_meetings) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',r.id,'ownerId',r.owner_id,'title',r.title,'inviteOnly',r.invite_only,'locked',r.locked,'createdAt',r.created_at,'expiresAt',r.expires_at,'endedAt',r.ended_at,'active',r.ended_at is null and r.expires_at>now())
$$;
create function comm_private.invitation_json(i public.comm_invitations) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',i.id,'meetingId',i.meeting_id,'inviterId',i.inviter_id,'userId',i.user_id,'status',case when i.status in ('pending','accepted') and (i.expires_at<=now() or exists(select 1 from public.comm_meetings r where r.id=i.meeting_id and (r.ended_at is not null or r.expires_at<=now()))) then 'expired' else i.status end,'createdAt',i.created_at,'updatedAt',i.updated_at,'expiresAt',i.expires_at)
$$;

-- Private helpers are callable only through the checked invoker RPCs below.
create function comm_private.conversation(peer uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); cid uuid;
begin
  if not comm_private.active() or peer=actor or not exists(select 1 from public.profiles p where p.id=peer and coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)) then raise exception 'Собеседник недоступен' using errcode='42501'; end if;
  insert into public.comm_conversations(user_a,user_b) values(least(actor,peer),greatest(actor,peer)) on conflict(user_a,user_b) do update set user_a=excluded.user_a returning id into cid;
  insert into public.comm_members(conversation_id,user_id) values(cid,actor),(cid,peer) on conflict do nothing;
  return cid;
end $$;
create function comm_private.invite(mid uuid,targets uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target uuid; r public.comm_meetings; i public.comm_invitations; result jsonb:='[]'; nid text; label text;
begin
  select * into r from public.comm_meetings where id=mid for update;
  if not comm_private.active() or r.id is null or r.ended_at is not null or r.expires_at<=now() or (r.owner_id<>actor and not comm_private.in_room(mid)) then raise exception 'Нет права приглашать в эту встречу' using errcode='42501'; end if;
  if r.locked then raise exception 'Вход во встречу закрыт'; end if;
  if coalesce(cardinality(targets),0) not between 1 and 20 or cardinality(targets)<>(select count(distinct t) from unnest(targets) t) then raise exception 'Выберите от 1 до 20 разных сотрудников'; end if;
  select data->>'name' into label from public.profiles where id=actor;
  foreach target in array targets loop
    if target=actor or not exists(select 1 from public.profiles p where p.id=target and coalesce((p.data->>'active')::boolean,true) and not coalesce((p.data->>'pending')::boolean,false)) then raise exception 'Сотрудник недоступен'; end if;
    if exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=target and p.state='removed') then raise exception 'Удалённого участника нельзя пригласить повторно'; end if;
    select * into i from public.comm_invitations where meeting_id=mid and user_id=target;
    if i.id is not null and i.status in ('pending','accepted','joined') and i.expires_at>now() then result:=result||jsonb_build_array(comm_private.invitation_json(i)); continue; end if;
    if i.id is not null and i.updated_at>now()-interval '60 seconds' then raise exception 'Повторное приглашение доступно через минуту'; end if;
    if exists(select 1 from public.comm_participants p where p.meeting_id=mid and p.user_id=target and p.state='joined') then continue; end if;
    nid:='meeting_'||gen_random_uuid()::text;
    insert into public.comm_invitations(meeting_id,inviter_id,user_id,notification_id) values(mid,actor,target,nid)
      on conflict(meeting_id,user_id) do update set inviter_id=actor,status='pending',updated_at=now(),expires_at=now()+interval '15 minutes',notification_id=nid returning * into i;
    insert into public.notifications(id,user_id,data) values(nid,target,jsonb_build_object('id',nid,'userId',target,'text',label||' приглашает во встречу «'||r.title||'»','at',now(),'read',false,'link','#/meetings/'||mid::text,'kind','meeting'));
    result:=result||jsonb_build_array(comm_private.invitation_json(i));
  end loop;
  return result;
end $$;

create function comm_private.dispatch(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); cid uuid; peer uuid; mid uuid; rid uuid; target uuid; ident uuid; txt text; result jsonb; saved comm_private.requests; msg public.comm_messages; r public.comm_meetings; i public.comm_invitations; member public.comm_members; p public.comm_participants; grant_row comm_private.grants; operation comm_private.controls; targets uuid[]; ids uuid[]; before_seq bigint; lim int; nid text; label text;
begin
  if not comm_private.active() then raise exception 'Войдите в активную учётную запись' using errcode='42501'; end if;
  if jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>65536 then raise exception 'Некорректный запрос'; end if;
  if p_action='index' then
    return jsonb_build_object(
      'serverTime',now(),
      'contacts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',data->>'name','photo',data->>'photo','active',coalesce((data->>'active')::boolean,true),'role',data->>'role','position',data->>'position') order by data->>'name'),'[]') from public.profiles where id<>actor and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false)),
      'conversations',(select coalesce(jsonb_agg(x.item order by x.last_seq desc nulls last),'[]') from (select jsonb_build_object('id',c.id,'peerId',case when c.user_a=actor then c.user_b else c.user_a end,'lastMessage',comm_private.message_json(last_message),'unread',(select count(*) from public.comm_messages m where m.conversation_id=c.id and m.sender_id<>actor and m.read_at is null),'peerOpenUntil',other.open_until,'typingUntil',other.typing_until) item,last_message.seq last_seq from public.comm_conversations c join public.comm_members mine on mine.conversation_id=c.id and mine.user_id=actor left join public.comm_members other on other.conversation_id=c.id and other.user_id<>actor left join lateral(select * from public.comm_messages m where m.conversation_id=c.id order by m.seq desc limit 1) last_message on true order by last_message.seq desc nulls last limit 100) x),
      'unread',(select count(*) from public.comm_messages m join public.comm_members c on c.conversation_id=m.conversation_id and c.user_id=actor where m.sender_id<>actor and m.read_at is null),
      'meetings',(select coalesce(jsonb_agg(comm_private.meeting_json(x) order by x.created_at desc),'[]') from (select * from public.comm_meetings where comm_private.sees_meeting(id) order by created_at desc limit 100) x),
      'invitations',(select coalesce(jsonb_agg(comm_private.invitation_json(x) order by x.updated_at desc),'[]') from (select * from public.comm_invitations where user_id=actor or inviter_id=actor or meeting_id in(select id from public.comm_meetings where owner_id=actor) order by updated_at desc limit 150) x)
    );
  elsif p_action='messages' then
    cid:=(p_body->>'conversationId')::uuid; before_seq:=nullif(p_body->>'before','')::bigint; lim:=least(greatest(coalesce((p_body->>'limit')::int,50),1),50);
    if not comm_private.member(cid) then raise exception 'Нет доступа к переписке' using errcode='42501'; end if;
    return (select coalesce(jsonb_agg(comm_private.message_json(x) order by x.seq),'[]') from (select * from public.comm_messages where conversation_id=cid and (before_seq is null or seq<before_seq) order by seq desc limit lim) x);
  elsif p_action='meeting' then
    mid:=(p_body->>'meetingId')::uuid; select * into r from public.comm_meetings where id=mid;
    if r.id is null then raise exception 'Встреча не найдена'; end if;
    if exists(select 1 from public.comm_participants where meeting_id=mid and user_id=actor and state='removed') then raise exception 'Организатор удалил вас из встречи' using errcode='42501'; end if;
    if r.invite_only and not comm_private.sees_meeting(mid) then raise exception 'Для этой встречи нужно приглашение' using errcode='42501'; end if;
    return jsonb_build_object('meeting',comm_private.meeting_json(r),'invitations',case when comm_private.sees_meeting(mid) then (select coalesce(jsonb_agg(comm_private.invitation_json(x)),'[]') from public.comm_invitations x where meeting_id=mid and (r.owner_id=actor or inviter_id=actor or user_id=actor)) else '[]'::jsonb end,'participants',case when comm_private.sees_meeting(mid) then (select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'identity',media_identity,'state',state,'joinedAt',joined_at)),'[]') from public.comm_participants where meeting_id=mid) else '[]'::jsonb end);
  elsif p_action='room_messages' then
    mid:=(p_body->>'meetingId')::uuid;
    if not comm_private.in_room(mid) then raise exception 'Чат доступен участникам активной встречи' using errcode='42501'; end if;
    return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'seq',seq::text,'senderId',sender_id,'text',text,'createdAt',created_at) order by seq),'[]') from (select * from public.comm_room_messages where meeting_id=mid order by seq desc limit 100) x);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,73491));
  if p_action in ('start','send','create','invite','respond','cancel_invite','control','admit','room_send') then
    rid:=(p_body->>'requestId')::uuid;
    if rid is null then raise exception 'Нет идентификатора запроса'; end if;
    select * into saved from comm_private.requests where user_id=actor and request_id=rid;
    if saved.request_id is not null then
      if saved.action<>p_action or saved.body_hash<>md5(p_body::text) then raise exception 'Идентификатор запроса уже использован'; end if;
      -- Admission is re-authorized below even for a retried request.
      if p_action<>'admit' then return saved.result; end if;
    end if;
    if saved.request_id is null and (select count(*) from comm_private.requests where user_id=actor and created_at>now()-interval '1 minute')>=100 then raise exception 'Слишком много действий. Подождите минуту'; end if;
  end if;
  case p_action
  when 'start' then
    cid:=comm_private.conversation((p_body->>'peerId')::uuid); result:=jsonb_build_object('conversationId',cid);
  when 'send' then
    cid:=(p_body->>'conversationId')::uuid; txt:=btrim(coalesce(p_body->>'text',''));
    if not comm_private.member(cid) then raise exception 'Нет доступа к переписке' using errcode='42501'; end if;
    select case when user_a=actor then user_b else user_a end into peer from public.comm_conversations where id=cid;
    if not exists(select 1 from public.profiles where id=peer and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false)) then raise exception 'Собеседник недоступен'; end if;
    if length(txt) not between 1 and 4000 then raise exception 'Сообщение должно содержать от 1 до 4000 символов'; end if;
    if (select count(*) from public.comm_messages where sender_id=actor and created_at>now()-interval '1 minute')>=60 then raise exception 'Слишком много сообщений. Подождите минуту'; end if;
    insert into public.comm_messages(id,conversation_id,sender_id,text) values(rid,cid,actor,txt) returning * into msg;
    result:=comm_private.message_json(msg);
    select * into member from public.comm_members where conversation_id=cid and user_id=peer;
    if coalesce(member.open_until,'-infinity')<now() and not exists(select 1 from public.notifications where id=member.notification_id and not coalesce((data->>'read')::boolean,false)) then
      nid:='dm_'||rid::text; select data->>'name' into label from public.profiles where id=actor;
      insert into public.notifications(id,user_id,data) values(nid,peer,jsonb_build_object('id',nid,'userId',peer,'text','Новое личное сообщение: '||label,'at',now(),'read',false,'link','#/messages/'||cid::text,'kind','message'));
      update public.comm_members set notification_id=nid where conversation_id=cid and user_id=peer;
    end if;
  when 'receipts' then
    cid:=(p_body->>'conversationId')::uuid;
    if not comm_private.member(cid) then raise exception 'Нет доступа к переписке' using errcode='42501'; end if;
    if jsonb_typeof(p_body->'ids')<>'array' or jsonb_array_length(p_body->'ids')>100 then raise exception 'Некорректное подтверждение'; end if;
    select array_agg(value::uuid) into ids from jsonb_array_elements_text(p_body->'ids');
    update public.comm_messages set delivered_at=coalesce(delivered_at,now()),read_at=case when coalesce((p_body->>'read')::boolean,false) then coalesce(read_at,now()) else read_at end where conversation_id=cid and id=any(ids) and sender_id<>actor;
    if not exists(select 1 from public.comm_messages where conversation_id=cid and sender_id<>actor and read_at is null) then update public.notifications set data=jsonb_set(data,'{read}','true') where user_id=actor and id=(select notification_id from public.comm_members where conversation_id=cid and user_id=actor); end if;
    result:=jsonb_build_object('ok',true);
  when 'activity' then
    cid:=(p_body->>'conversationId')::uuid;
    if not comm_private.member(cid) then raise exception 'Нет доступа к переписке' using errcode='42501'; end if;
    update public.comm_members set open_until=case when coalesce((p_body->>'open')::boolean,false) then now()+interval '20 seconds' else null end,typing_until=case when coalesce((p_body->>'open')::boolean,false) and coalesce((p_body->>'typing')::boolean,false) then now()+interval '5 seconds' else null end where conversation_id=cid and user_id=actor;
    result:=jsonb_build_object('ok',true);
  when 'create' then
    txt:=btrim(coalesce(p_body->>'title',''));
    if length(txt) not between 3 and 120 then raise exception 'Название встречи: от 3 до 120 символов'; end if;
    if (select count(*) from public.comm_meetings where owner_id=actor and created_at>now()-interval '1 hour')>=10 then raise exception 'Слишком много новых встреч. Повторите позже'; end if;
    peer:=nullif(p_body->>'peerId','')::uuid;
    insert into public.comm_meetings(owner_id,title,invite_only) values(actor,txt,coalesce((p_body->>'inviteOnly')::boolean,false) or peer is not null) returning * into r;
    mid:=r.id;
    if peer is not null then
      cid:=comm_private.conversation(peer); perform comm_private.invite(mid,array[peer]);
      insert into public.comm_messages(id,conversation_id,sender_id,meeting_id) values(rid,cid,actor,mid);
    end if;
    result:=jsonb_build_object('meeting',comm_private.meeting_json(r),'conversationId',cid);
  when 'invite' then
    mid:=(p_body->>'meetingId')::uuid;
    if (select count(*) from comm_private.requests where user_id=actor and action='invite' and created_at>now()-interval '1 minute')>=10 then raise exception 'Слишком много приглашений. Подождите минуту'; end if;
    select array_agg(value::uuid) into targets from jsonb_array_elements_text(p_body->'userIds');
    result:=comm_private.invite(mid,targets);
  when 'respond' then
    select * into i from public.comm_invitations where id=(p_body->>'invitationId')::uuid for update;
    if i.id is null or i.user_id<>actor then raise exception 'Нет доступа к приглашению' using errcode='42501'; end if;
    select * into r from public.comm_meetings where id=i.meeting_id;
    if r.ended_at is not null or r.expires_at<=now() or i.expires_at<=now() or i.status not in ('pending','accepted') then raise exception 'Приглашение уже не активно'; end if;
    if p_body->>'response' not in ('accepted','declined') then raise exception 'Неизвестный ответ'; end if;
    update public.comm_invitations set status=p_body->>'response',updated_at=now() where id=i.id returning * into i;
    update public.notifications set data=jsonb_set(data,'{read}','true') where id=i.notification_id and user_id=actor;
    result:=comm_private.invitation_json(i);
    if i.status='declined' and r.invite_only and exists(select 1 from public.comm_participants where meeting_id=i.meeting_id and user_id=actor and joined_at is null) then
      update public.comm_participants set state='left',media_updated_at=now() where meeting_id=i.meeting_id and user_id=actor;
      insert into comm_private.controls(id,meeting_id,user_id,action,target_id,identities) values(rid,i.meeting_id,actor,'remove',actor,array(select id from comm_private.grants where meeting_id=i.meeting_id and user_id=actor));
      result:=result||jsonb_build_object('controlId',rid);
    end if;
  when 'cancel_invite' then
    select * into i from public.comm_invitations where id=(p_body->>'invitationId')::uuid for update;
    if i.id is null or (i.inviter_id<>actor and not exists(select 1 from public.comm_meetings where id=i.meeting_id and owner_id=actor)) then raise exception 'Нет права отменять приглашение' using errcode='42501'; end if;
    if i.status not in ('pending','accepted') then raise exception 'Приглашение уже не активно'; end if;
    update public.comm_invitations set status='cancelled',updated_at=now() where id=i.id returning * into i;
    result:=comm_private.invitation_json(i);
    if exists(select 1 from public.comm_meetings where id=i.meeting_id and invite_only) and exists(select 1 from public.comm_participants where meeting_id=i.meeting_id and user_id=i.user_id and joined_at is null) then
      update public.comm_participants set state='left',media_updated_at=now() where meeting_id=i.meeting_id and user_id=i.user_id;
      insert into comm_private.controls(id,meeting_id,user_id,action,target_id,identities) values(rid,i.meeting_id,actor,'remove',i.user_id,array(select id from comm_private.grants where meeting_id=i.meeting_id and user_id=i.user_id));
      result:=result||jsonb_build_object('controlId',rid);
    end if;
  when 'admit' then
    if saved.request_id is null and (select count(*) from comm_private.requests where user_id=actor and action='admit' and created_at>now()-interval '1 minute')>=15 then raise exception 'Слишком много подключений. Подождите минуту'; end if;
    mid:=(p_body->>'meetingId')::uuid; select * into r from public.comm_meetings where id=mid for update;
    select * into p from public.comm_participants where meeting_id=mid and user_id=actor;
    if r.id is null or r.ended_at is not null or r.expires_at<=now() then raise exception 'Встреча завершена или ссылка недействительна'; end if;
    if p.state='removed' then raise exception 'Организатор удалил вас из встречи' using errcode='42501'; end if;
    if r.locked and actor<>r.owner_id and p.joined_at is null then raise exception 'Организатор закрыл вход новым участникам' using errcode='42501'; end if;
    if r.invite_only and r.owner_id<>actor and not exists(select 1 from public.comm_invitations where meeting_id=mid and user_id=actor and status in ('accepted','joined') and expires_at>now()) and p.joined_at is null then raise exception 'Сначала примите приглашение' using errcode='42501'; end if;
    if saved.request_id is not null then
      select * into grant_row from comm_private.grants where user_id=actor and request_id=rid;
      if grant_row.expires_at<=now() or grant_row.revoked_at is not null or p.media_identity<>grant_row.id then raise exception 'Доступ устарел. Подключитесь повторно'; end if;
      result:=saved.result;
    else
      ident:=gen_random_uuid();
      insert into comm_private.grants(id,meeting_id,user_id,request_id) values(ident,mid,actor,rid);
      insert into public.comm_participants(meeting_id,user_id,media_identity,state) values(mid,actor,ident,'admitted') on conflict(meeting_id,user_id) do update set media_identity=ident,state='admitted',media_sid=null,media_updated_at=null;
      select data->>'name' into label from public.profiles where id=actor;
      result:=jsonb_build_object('meetingId',mid,'room','kc_'||mid::text,'identity',ident,'userId',actor,'name',label,'ownerId',r.owner_id);
    end if;
  when 'control' then
    mid:=(p_body->>'meetingId')::uuid; select * into r from public.comm_meetings where id=mid for update;
    if r.id is null or r.owner_id<>actor then raise exception 'Действие доступно только организатору' using errcode='42501'; end if;
    txt:=p_body->>'action'; target:=nullif(p_body->>'userId','')::uuid;
    if txt not in ('end','lock','unlock','remove','mute') then raise exception 'Неизвестное действие организатора'; end if;
    if txt<>'end' and (r.ended_at is not null or r.expires_at<=now()) then raise exception 'Встреча завершена'; end if;
    if txt in ('remove','mute') and (target is null or target=actor or not exists(select 1 from public.comm_participants where meeting_id=mid and user_id=target and state in ('admitted','joined','left'))) then raise exception 'Участник недоступен'; end if;
    if txt='end' then
      update public.comm_meetings set ended_at=coalesce(ended_at,now()),locked=true where id=mid;
      update public.comm_invitations set status='cancelled',updated_at=now() where meeting_id=mid and status in ('pending','accepted');
      delete from public.comm_room_messages where meeting_id=mid;
    elsif txt in ('lock','unlock') then update public.comm_meetings set locked=(txt='lock') where id=mid;
    elsif txt='remove' then
      update public.comm_participants set state='removed',media_updated_at=now() where meeting_id=mid and user_id=target;
      update public.comm_invitations set status='cancelled',updated_at=now() where meeting_id=mid and user_id=target;
    end if;
    select coalesce(array_agg(g.id),'{}') into ids from comm_private.grants g where g.meeting_id=mid and g.revoked_at is null and (txt='end' or (txt='remove' and g.user_id=target) or (txt='mute' and g.id=(select media_identity from public.comm_participants where meeting_id=mid and user_id=target)) or (txt='lock' and g.user_id<>actor and not exists(select 1 from public.comm_participants member_row where member_row.meeting_id=mid and member_row.user_id=g.user_id and member_row.joined_at is not null)));
    insert into comm_private.controls(id,meeting_id,user_id,action,target_id,identities) values(rid,mid,actor,txt,target,ids);
    result:=jsonb_build_object('controlId',rid,'action',txt,'meetingId',mid);
  when 'room_send' then
    mid:=(p_body->>'meetingId')::uuid; txt:=btrim(coalesce(p_body->>'text',''));
    if not comm_private.in_room(mid) then raise exception 'Чат доступен участникам активной встречи' using errcode='42501'; end if;
    if length(txt) not between 1 and 2000 then raise exception 'Сообщение: от 1 до 2000 символов'; end if;
    if (select count(*) from public.comm_room_messages where sender_id=actor and created_at>now()-interval '1 minute')>=60 then raise exception 'Слишком много сообщений. Подождите минуту'; end if;
    insert into public.comm_room_messages(id,meeting_id,sender_id,text) values(rid,mid,actor,txt);
    result:=jsonb_build_object('ok',true);
  when 'leave' then
    mid:=(p_body->>'meetingId')::uuid;
    update public.comm_participants set state='left',media_updated_at=now() where meeting_id=mid and user_id=actor and state<>'removed' and media_identity=(p_body->>'identity')::uuid;
    result:=jsonb_build_object('ok',true);
  else raise exception 'Неизвестное действие';
  end case;
  if rid is not null and saved.request_id is null then insert into comm_private.requests(user_id,request_id,action,body_hash,result) values(actor,rid,p_action,md5(p_body::text),result); end if;
  return result;
end $$;

-- Only the Edge Function can reconcile real media-server events and execute moderation.
create function comm_private.media_dispatch(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(p_body->>'userId')::uuid; mid uuid:=(p_body->>'meetingId')::uuid; ident uuid; p public.comm_participants; r public.comm_meetings; op comm_private.controls; kind text; event_id text; event_at timestamptz;
begin
  if p_action in ('admission','presence') then
    select * into r from public.comm_meetings where id=mid; select * into p from public.comm_participants where meeting_id=mid and user_id=actor;
    ident:=(p_body->>'identity')::uuid;
    if r.id is null or r.ended_at is not null or r.expires_at<=now() or p.user_id is null or p.state='removed' or p.media_identity<>ident or exists(select 1 from comm_private.grants where id=ident and revoked_at is not null) or not exists(select 1 from public.profiles where id=actor and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false)) or (p_action='admission' and not exists(select 1 from comm_private.grants where id=ident and user_id=actor and meeting_id=mid and expires_at>now() and revoked_at is null)) or (r.locked and actor<>r.owner_id and p.joined_at is null) then raise exception 'Доступ ко встрече отозван' using errcode='42501'; end if;
    if r.invite_only and r.owner_id<>actor and p.joined_at is null and not exists(select 1 from public.comm_invitations where meeting_id=mid and user_id=actor and status in ('accepted','joined') and expires_at>now()) then raise exception 'Приглашение отозвано' using errcode='42501'; end if;
    return jsonb_build_object('ok',true,'revoke',(select coalesce(jsonb_agg(id),'[]') from comm_private.grants where meeting_id=mid and user_id=actor and id<>ident and revoked_at is null));
  elsif p_action='revoked' then
    update comm_private.grants set revoked_at=coalesce(revoked_at,now()) where meeting_id=mid and id=(p_body->>'identity')::uuid;
    return jsonb_build_object('ok',true);
  elsif p_action='pending' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'userId',user_id)),'[]') from(select id,user_id from comm_private.controls where applied_at is null order by created_at limit 5) x);
  elsif p_action='control' then
    select * into op from comm_private.controls where id=(p_body->>'controlId')::uuid and user_id=actor;
    if op.id is null then raise exception 'Действие не найдено' using errcode='42501'; end if;
    return jsonb_build_object('id',op.id,'meetingId',op.meeting_id,'room','kc_'||op.meeting_id::text,'action',op.action,'identities',op.identities,'applied',op.applied_at is not null);
  elsif p_action='control_done' then
    update comm_private.controls set applied_at=now() where id=(p_body->>'controlId')::uuid and user_id=actor;
    return jsonb_build_object('ok',true);
  elsif p_action='event' then
    event_id:=p_body->>'eventId'; kind:=p_body->>'event'; ident:=(p_body->>'identity')::uuid; event_at:=(p_body->>'at')::timestamptz;
    if length(event_id) not between 1 and 200 or event_at>now()+interval '1 minute' then raise exception 'Некорректное событие'; end if;
    insert into comm_private.webhooks(id) values(event_id) on conflict do nothing;
    if not found then return jsonb_build_object('ok',true); end if;
    select * into r from public.comm_meetings where id=mid;
    if r.id is null then return jsonb_build_object('ok',true); end if;
    select * into p from public.comm_participants where meeting_id=mid and media_identity=ident;
    if p.user_id is null or r.ended_at is not null or r.expires_at<=now() or p.state='removed' or exists(select 1 from comm_private.grants where id=ident and revoked_at is not null) or not exists(select 1 from public.profiles where id=p.user_id and coalesce((data->>'active')::boolean,true) and not coalesce((data->>'pending')::boolean,false)) or (r.locked and r.owner_id<>p.user_id and p.joined_at is null) or (r.invite_only and r.owner_id<>p.user_id and p.joined_at is null and not exists(select 1 from public.comm_invitations where meeting_id=mid and user_id=p.user_id and status in ('accepted','joined') and expires_at>now())) then return jsonb_build_object('remove',true); end if;
    if p.media_updated_at is not null and p.media_updated_at>event_at then return jsonb_build_object('ok',true); end if;
    if kind='joined' then
      update public.comm_participants set state='joined',joined_at=coalesce(joined_at,event_at),media_sid=p_body->>'sid',media_updated_at=event_at where meeting_id=mid and user_id=p.user_id;
      update public.comm_invitations set status='joined',updated_at=now() where meeting_id=mid and user_id=p.user_id and status in ('pending','accepted');
    elsif kind='left' and (p.media_sid is null or p.media_sid=p_body->>'sid') then update public.comm_participants set state='left',media_updated_at=event_at where meeting_id=mid and user_id=p.user_id;
    end if;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Неизвестное действие сервера';
end $$;

create function comm_private.cleanup() returns void language plpgsql security definer set search_path='' as $$
declare r public.comm_meetings; p public.comm_participants; endpoint text; secret text;
begin
  for r in update public.comm_meetings m set ended_at=now(),locked=true where m.ended_at is null and (m.expires_at<=now() or not exists(select 1 from public.profiles u where u.id=m.owner_id and coalesce((u.data->>'active')::boolean,true) and not coalesce((u.data->>'pending')::boolean,false))) returning m.* loop
    update public.comm_invitations set status='cancelled',updated_at=now() where meeting_id=r.id and status in ('pending','accepted');
    insert into comm_private.controls(id,meeting_id,user_id,action,identities) values(gen_random_uuid(),r.id,r.owner_id,'end',array(select id from comm_private.grants where meeting_id=r.id));
  end loop;
  for p in update public.comm_participants m set state='removed',media_updated_at=now() where m.state in ('admitted','joined') and not exists(select 1 from public.profiles u where u.id=m.user_id and coalesce((u.data->>'active')::boolean,true) and not coalesce((u.data->>'pending')::boolean,false)) returning m.* loop
    insert into comm_private.controls(id,meeting_id,user_id,action,target_id,identities) select gen_random_uuid(),active_room.id,active_room.owner_id,'remove',p.user_id,array(select id from comm_private.grants where meeting_id=active_room.id and user_id=p.user_id) from public.comm_meetings active_room where active_room.id=p.meeting_id and active_room.ended_at is null;
  end loop;
  delete from public.comm_room_messages where meeting_id in(select id from public.comm_meetings where ended_at is not null or expires_at<now());
  delete from comm_private.requests where created_at<now()-interval '30 days';
  delete from comm_private.grants where created_at<now()-interval '1 day';
  delete from comm_private.webhooks where created_at<now()-interval '4 days';
  if exists(select 1 from comm_private.controls where applied_at is null) then
    select value into endpoint from public.app_secrets where key='functions_url'; select value into secret from public.app_secrets where key='hook_secret';
    if endpoint like 'https://%' and secret is not null then perform net.http_post(url:=endpoint||'/communications',body:='{"action":"cleanup"}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-hook-secret',secret),timeout_milliseconds:=20000); end if;
  end if;
end $$;

create function public.communications(p_action text,p_body jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select comm_private.dispatch(p_action,coalesce(p_body,'{}'))$$;
create function public.communications_media(p_action text,p_body jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select comm_private.media_dispatch(p_action,p_body)$$;
revoke all on all functions in schema comm_private from public,anon,authenticated,service_role;
grant execute on function comm_private.active(),comm_private.member(uuid),comm_private.sees_meeting(uuid),comm_private.in_room(uuid),comm_private.dispatch(text,jsonb) to authenticated;
grant execute on function comm_private.media_dispatch(text,jsonb) to service_role;
grant execute on function comm_private.cleanup() to service_role;
revoke all on function public.communications(text,jsonb),public.communications_media(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.communications(text,jsonb) to authenticated;
grant execute on function public.communications_media(text,jsonb) to service_role;

-- Retain the existing publication. No private tables, tokens or request receipts are published.
do $$ declare t text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array['comm_conversations','comm_members','comm_messages','comm_meetings','comm_invitations','comm_participants','comm_room_messages'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
    end loop;
  end if;
end $$;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('communications-cleanup','* * * * *','select comm_private.cleanup()');
  end if;
end $$;
