import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
let db;
const ids={alice:'00000000-0000-0000-0000-000000000001',bob:'00000000-0000-0000-0000-000000000002',third:'00000000-0000-0000-0000-000000000003',head:'00000000-0000-0000-0000-000000000004'};
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
async function as(user,fn,role='authenticated') { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");} }
const call=(user,action,body={})=>as(user,()=>scalar('select public.communications($1,$2::jsonb)',[action,JSON.stringify(body)]));
const media=(action,body={})=>as(null,()=>scalar('select public.communications_media($1,$2::jsonb)',[action,JSON.stringify(body)]),'service_role');
const start=async(a=ids.alice,b=ids.bob)=>(await call(a,'start',{peerId:b,requestId:randomUUID()})).conversationId;
const create=async(user=ids.alice,extra={})=>(await call(user,'create',{title:'Рабочая встреча',requestId:randomUUID(),...extra})).meeting;
const send=(who,cid,text='Сообщение',requestId=randomUUID())=>call(who,'send',{conversationId:cid,text,requestId});
const admit=(who,meetingId,requestId=randomUUID())=>call(who,'admit',{meetingId,requestId});
async function joined(who,mid){const grant=await admit(who,mid);await media('event',{meetingId:mid,identity:grant.identity,event:'joined',eventId:randomUUID(),at:new Date().toISOString(),sid:'sid-'+grant.identity});return grant;}
before(async()=>{
 db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema extensions;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema net;create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer default 5000) returns bigint language sql as $$select 1::bigint$$;");
 const initial=readFileSync(new URL('../supabase/migrations/001_init.sql',import.meta.url),'utf8');
 await db.exec(initial.slice(initial.indexOf('create table profiles'),initial.indexOf('-- Хранилище вложений')).replace(/select cron\.schedule\([^;]+;/g,'').replace(/alter publication supabase_realtime[^;]+;/g,''));
 await db.exec('grant usage on schema public to authenticated,anon,service_role;grant select on public.profiles to authenticated;');
 await db.exec(readFileSync(new URL('../supabase/migrations/20261102075931_communications_and_meetings.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261102100858_meeting_scheduling_notifications.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261102110233_meeting_minutes.sql',import.meta.url),'utf8'));
 for(const [name,id] of Object.entries(ids)){await db.query('insert into auth.users values($1)',[id]);await db.query('insert into profiles(id,data) values($1,$2::jsonb)',[id,JSON.stringify({id,name,role:name==='head'?'head':'member',active:true,pending:false})]);}
});
beforeEach(async()=>{await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec('truncate comm_private.requests,comm_private.grants,comm_private.controls,comm_private.webhooks,comm_conversations,comm_meetings,notifications cascade');await db.query("update profiles set data=data||'{\"active\":true,\"pending\":false}'::jsonb");});
after(async()=>{await db.close();});
test('one pair has one durable dialog, only the pair can read it, even a head cannot access someone else’s messages',async()=>{
 const cid=await start();assert.equal(await start(ids.bob,ids.alice),cid);const msg=await send(ids.alice,cid,'Личная переписка');
 assert.equal((await call(ids.bob,'messages',{conversationId:cid}))[0].text,'Личная переписка');
 for(const who of [ids.third,ids.head]){await assert.rejects(call(who,'messages',{conversationId:cid}),/Нет доступа/);assert.equal(await as(who,()=>scalar('select count(*)::int from comm_messages')),0);}
 assert.equal(await as(ids.bob,()=>scalar('select count(*)::int from comm_messages where id=$1',[msg.id])),1);
});
test('lost responses can be retried without duplicate messages or notifications, changed reuse is rejected',async()=>{
 const cid=await start(),rid=randomUUID();const first=await send(ids.alice,cid,'Точный текст',rid);assert.deepEqual(await send(ids.alice,cid,'Точный текст',rid),first);
 assert.equal(await scalar('select count(*)::int from comm_messages'),1);assert.equal(await scalar('select count(*)::int from notifications'),1);
 await assert.rejects(send(ids.alice,cid,'Подмена',rid),/уже использован/);
});
test('delivery and read receipts require the recipient, background receipt is not reading, counters persist across sessions',async()=>{
 const cid=await start(),msg=await send(ids.alice,cid);
 await call(ids.alice,'receipts',{conversationId:cid,ids:[msg.id],read:true});assert.equal((await call(ids.alice,'messages',{conversationId:cid}))[0].readAt,null);
 assert.equal((await call(ids.bob,'index')).unread,1);
 await call(ids.bob,'receipts',{conversationId:cid,ids:[msg.id],read:false});let row=(await call(ids.alice,'messages',{conversationId:cid}))[0];assert.ok(row.deliveredAt);assert.equal(row.readAt,null);
 await call(ids.bob,'receipts',{conversationId:cid,ids:[msg.id],read:true});row=(await call(ids.alice,'messages',{conversationId:cid}))[0];assert.ok(row.readAt);assert.equal((await call(ids.bob,'index')).unread,0);
});
test('an open focused dialog suppresses duplicate notifications; typing and presence have short leases',async()=>{
 const cid=await start();await call(ids.bob,'activity',{conversationId:cid,open:true,typing:true});await send(ids.alice,cid);assert.equal(await scalar('select count(*)::int from notifications'),0);
 const peer=(await call(ids.alice,'index')).conversations[0];assert.ok(Date.parse(peer.typingUntil)>Date.now());assert.ok(Date.parse(peer.peerOpenUntil)>Date.now());
 await call(ids.bob,'activity',{conversationId:cid,open:false,typing:false});await send(ids.alice,cid);await send(ids.alice,cid);assert.equal(await scalar('select count(*)::int from notifications'),1);
});
test('history uses a stable keyset and rejects empty or oversized messages, direct writes and sender forgery',async()=>{
 const cid=await start();for(let i=0;i<8;i++)await send(ids.alice,cid,'Текст '+i);
 const latest=await call(ids.bob,'messages',{conversationId:cid,limit:3});const older=await call(ids.bob,'messages',{conversationId:cid,limit:3,before:latest[0].seq});assert.equal(new Set([...latest,...older].map(x=>x.id)).size,6);
 for(const text of [' ','x'.repeat(4001)])await assert.rejects(send(ids.alice,cid,text),/4000/);
 await assert.rejects(as(ids.alice,()=>db.query('update comm_messages set sender_id=$1',[ids.bob])),/permission denied/);
});
test('meeting invite status is server-owned and real admission alone does not claim joined',async()=>{
 const r=await create();const rid=randomUUID();const [inv]=await call(ids.alice,'invite',{meetingId:r.id,userIds:[ids.bob],requestId:rid});
 assert.deepEqual(await call(ids.alice,'invite',{meetingId:r.id,userIds:[ids.bob],requestId:rid}),[inv]);assert.equal(await scalar('select count(*)::int from notifications'),1);
 await assert.rejects(call(ids.third,'respond',{invitationId:inv.id,response:'accepted',requestId:randomUUID()}),/Нет доступа/);
 await call(ids.bob,'respond',{invitationId:inv.id,response:'accepted',requestId:randomUUID()});const token=await admit(ids.bob,r.id);
 assert.equal((await call(ids.bob,'index')).invitations[0].status,'accepted');
 await media('event',{meetingId:r.id,identity:token.identity,event:'joined',eventId:randomUUID(),at:new Date().toISOString(),sid:'real-sid'});assert.equal((await call(ids.bob,'index')).invitations[0].status,'joined');
});
test('only the organizer can moderate, lock blocks new arrivals, removal prevents new and reused admissions',async()=>{
 const r=await create();const token=await joined(ids.bob,r.id),rid=randomUUID();
 await assert.rejects(call(ids.head,'control',{meetingId:r.id,action:'end',requestId:randomUUID()}),/организатору/);
 await call(ids.alice,'control',{meetingId:r.id,action:'lock',requestId:randomUUID()});await assert.rejects(admit(ids.third,r.id),/закрыл вход/);await admit(ids.bob,r.id);
 const admitted=await admit(ids.third,(await create(ids.third)).id);assert.ok(admitted.identity);
 const before=await admit(ids.bob,r.id,rid);await call(ids.alice,'control',{meetingId:r.id,action:'remove',userId:ids.bob,requestId:randomUUID()});
 await assert.rejects(admit(ids.bob,r.id),/удалил/);await assert.rejects(admit(ids.bob,r.id,rid),/удалил/);await assert.rejects(media('admission',{userId:ids.bob,meetingId:r.id,identity:before.identity}),/отозван/);
 const old=await media('event',{meetingId:r.id,identity:token.identity,event:'joined',eventId:randomUUID(),at:new Date().toISOString(),sid:'old'});assert.equal(old.remove,true);
});
test('a call from a personal dialog uses the same meeting and invitations atomically',async()=>{
 const result=await call(ids.alice,'create',{title:'Звонок коллеге',peerId:ids.bob,requestId:randomUUID()});
 assert.ok(result.meeting.inviteOnly);const cards=await call(ids.bob,'messages',{conversationId:result.conversationId});assert.equal(cards[0].meetingId,result.meeting.id);assert.equal((await call(ids.bob,'index')).invitations[0].meetingId,result.meeting.id);
 await assert.rejects(admit(ids.bob,result.meeting.id),/примите/);
});
test('meeting chat requires actual verified participation and is cleared on end, durable personal history remains',async()=>{
 const r=await create(),cid=await start();await send(ids.alice,cid,'Сохраняется');await admit(ids.alice,r.id);
 await assert.rejects(call(ids.alice,'room_send',{meetingId:r.id,text:'До подключения',requestId:randomUUID()}),/участникам/);
 await joined(ids.alice,r.id);await call(ids.alice,'room_send',{meetingId:r.id,text:'Встреча',requestId:randomUUID()});assert.equal((await call(ids.alice,'room_messages',{meetingId:r.id})).length,1);
 await call(ids.alice,'control',{meetingId:r.id,action:'end',requestId:randomUUID()});await assert.rejects(admit(ids.bob,r.id),/завершена/);assert.equal(await scalar('select count(*)::int from comm_room_messages'),0);assert.equal((await call(ids.bob,'messages',{conversationId:cid})).length,1);
});
test('inactive accounts, anonymous callers and browser roles cannot get media authority or private receipts',async()=>{
 const cid=await start();await db.query("update profiles set data=data||'{\"active\":false}'::jsonb where id=$1",[ids.bob]);await assert.rejects(send(ids.alice,cid),/недоступен/);await assert.rejects(call(ids.bob,'index'),/активную/);
 await assert.rejects(as(null,()=>scalar("select public.communications('index','{}')"),'anon'),/permission denied/);
 await assert.rejects(as(ids.alice,()=>scalar("select public.communications_media('pending','{}')")),/permission denied/);
 await assert.rejects(as(ids.alice,()=>scalar('select count(*) from comm_private.requests')),/permission denied/);
});
test('declining or cancelling an invitation revokes an issued admission before actual media join',async()=>{
 for(const response of ['declined','cancelled']){
  const r=await create(ids.alice,{inviteOnly:true});
  const [inv]=await call(ids.alice,'invite',{meetingId:r.id,userIds:[ids.bob],requestId:randomUUID()});
  await call(ids.bob,'respond',{invitationId:inv.id,response:'accepted',requestId:randomUUID()});const grant=await admit(ids.bob,r.id);
  const result=response==='declined'?await call(ids.bob,'respond',{invitationId:inv.id,response,requestId:randomUUID()}):await call(ids.alice,'cancel_invite',{invitationId:inv.id,requestId:randomUUID()});
  assert.ok(result.controlId);const control=await media('control',{userId:response==='declined'?ids.bob:ids.alice,controlId:result.controlId});assert.ok(control.identities.includes(grant.identity));
  await assert.rejects(media('admission',{userId:ids.bob,meetingId:r.id,identity:grant.identity}),/отозвано/);
  assert.equal((await media('event',{meetingId:r.id,identity:grant.identity,event:'joined',eventId:randomUUID(),at:new Date().toISOString(),sid:'late'})).remove,true);
 }
});
test('invitation expiry, cooldown, admission expiry and message rate limits are checked on the server',async()=>{
 const r=await create(ids.alice,{inviteOnly:true});const [inv]=await call(ids.alice,'invite',{meetingId:r.id,userIds:[ids.bob],requestId:randomUUID()});
 await call(ids.bob,'respond',{invitationId:inv.id,response:'declined',requestId:randomUUID()});
 await assert.rejects(call(ids.alice,'invite',{meetingId:r.id,userIds:[ids.bob],requestId:randomUUID()}),/через минуту/);
 await db.query("update comm_invitations set status='pending',expires_at=now()-interval '1 second' where id=$1",[inv.id]);
 assert.equal((await call(ids.bob,'index')).invitations[0].status,'expired');await assert.rejects(call(ids.bob,'respond',{invitationId:inv.id,response:'accepted',requestId:randomUUID()}),/не активно/);
 const rid=randomUUID(),grant=await admit(ids.alice,r.id,rid);await db.query("update comm_private.grants set expires_at=now()-interval '1 second' where id=$1",[grant.identity]);
 await assert.rejects(admit(ids.alice,r.id,rid),/устарел/);
 const cid=await start();for(let i=0;i<60;i++)await send(ids.alice,cid,'Номер '+i);await assert.rejects(send(ids.alice,cid),/Слишком много сообщений/);
});
test('media events are idempotent and an older disconnect cannot replace a newer session',async()=>{
 const r=await create(),grant=await admit(ids.bob,r.id),now=Date.now(),eventId=randomUUID();
 const event={meetingId:r.id,identity:grant.identity,event:'joined',eventId,at:new Date(now).toISOString(),sid:'new-sid'};
 await media('event',event);await media('event',event);assert.equal(await scalar('select count(*)::int from comm_private.webhooks'),1);
 await media('event',{...event,eventId:randomUUID(),event:'left',at:new Date(now-500).toISOString(),sid:'old-sid'});
 await media('event',{...event,eventId:randomUUID(),event:'left',at:new Date(now+100).toISOString(),sid:'old-sid'});
 assert.equal(await scalar('select state from comm_participants where meeting_id=$1 and user_id=$2',[r.id,ids.bob]),'joined');
 const second=await admit(ids.bob,r.id);assert.notEqual(second.identity,grant.identity);assert.equal((await media('event',{...event,eventId:randomUUID()})).remove,true);
 assert.deepEqual((await media('admission',{userId:ids.bob,meetingId:r.id,identity:second.identity})).revoke,[grant.identity]);
 await media('revoked',{meetingId:r.id,identity:grant.identity});assert.deepEqual((await media('admission',{userId:ids.bob,meetingId:r.id,identity:second.identity})).revoke,[]);
});
test('expiry cleanup closes meetings, clears transient chat and queues physical SFU enforcement without changing durable messages',async()=>{
 const r=await create(),cid=await start();await send(ids.alice,cid,'История команды');await joined(ids.alice,r.id);await call(ids.alice,'room_send',{meetingId:r.id,text:'Временный чат',requestId:randomUUID()});
 await db.query("update comm_meetings set expires_at=now()-interval '1 second' where id=$1",[r.id]);await db.exec('select comm_private.cleanup()');
 assert.equal((await call(ids.alice,'meeting',{meetingId:r.id})).meeting.active,false);assert.equal(await scalar('select count(*)::int from comm_room_messages'),0);
 const [pending]=await media('pending');assert.ok(pending.id);const control=await media('control',{controlId:pending.id,userId:ids.alice});assert.equal(control.action,'end');assert.equal(control.identities.length,1);
 assert.equal((await call(ids.bob,'messages',{conversationId:cid})).length,1);await media('control_done',{userId:ids.alice,controlId:pending.id});assert.deepEqual(await media('pending'),[]);
});
test('private message and notification creation are atomic if the existing notification writer fails',async()=>{
 const cid=await start(),rid=randomUUID();
 await db.exec("create function comm_private.test_notification_fail() returns trigger language plpgsql as $$begin raise exception 'fixture notification unavailable';end$$;create trigger test_notice_failure before insert on notifications for each row execute function comm_private.test_notification_fail();");
 try{await assert.rejects(send(ids.alice,cid,'Повторяемая отправка',rid),/notification unavailable/);assert.equal(await scalar('select count(*)::int from comm_messages'),0);assert.equal(await scalar('select count(*)::int from comm_private.requests where request_id=$1',[rid]),0);}
 finally{await db.exec('drop trigger test_notice_failure on notifications;drop function comm_private.test_notification_fail()');}
 await send(ids.alice,cid,'Повторяемая отправка',rid);assert.equal(await scalar('select count(*)::int from comm_messages'),1);
});
test('future meetings last eight hours from their scheduled time and cannot admit media early',async()=>{
 const scheduledAt=new Date(Date.now()+86400000).toISOString();const r=await create(ids.alice,{scheduledAt,notifyAll:true});
 assert.equal(r.phase,'scheduled');assert.equal(r.canJoin,false);assert.equal(Date.parse(r.expiresAt)-Date.parse(r.scheduledAt),8*3600000);
 assert.ok((await call(ids.third,'index')).meetings.some(item=>item.id===r.id));await assert.rejects(admit(ids.bob,r.id),/Подключение откроется/);
 await assert.rejects(media('admission',{meetingId:r.id,userId:ids.bob,identity:randomUUID()}),/ещё не наступило/);
 assert.equal((await media('event',{meetingId:r.id,identity:randomUUID(),event:'joined',eventId:randomUUID(),at:new Date().toISOString(),sid:'early'})).remove,true);
 await assert.rejects(create(ids.alice,{scheduledAt:new Date(Date.now()-1000).toISOString()}),/будущее время/);
});
test('broadcast creation notifies each active colleague once, without affecting private calls or inactive accounts',async()=>{
 await db.query("update profiles set data=data||'{\"pending\":true}'::jsonb where id=$1",[ids.third]);
 const rid=randomUUID(),body={title:'Общая планёрка',scheduledAt:new Date(Date.now()+3600000).toISOString(),notifyAll:true,requestId:rid};
 const first=await call(ids.alice,'create',body);assert.deepEqual(await call(ids.alice,'create',body),first);
 assert.equal(await scalar('select count(*)::int from notifications'),3);assert.equal(await scalar('select count(*)::int from comm_private.meeting_notices'),1);
 assert.equal(await scalar('select count(*)::int from notifications where user_id=$1',[ids.third]),0);
 await assert.rejects(create(ids.alice,{notifyAll:true,inviteOnly:true}),/личной встречи/);
});
test('private scheduled invitations remain valid until the meeting ends and do not expose it to other staff',async()=>{
 const r=await create(ids.alice,{scheduledAt:new Date(Date.now()+2*86400000).toISOString(),inviteOnly:true});
 const [inv]=await call(ids.alice,'invite',{meetingId:r.id,userIds:[ids.bob],requestId:randomUUID()});assert.equal(inv.expiresAt,r.expiresAt);
 await call(ids.bob,'respond',{invitationId:inv.id,response:'accepted',requestId:randomUUID()});
 assert.ok((await call(ids.bob,'index')).meetings.some(item=>item.id===r.id));assert.ok(!(await call(ids.third,'index')).meetings.some(item=>item.id===r.id));
 await assert.rejects(call(ids.third,'meeting',{meetingId:r.id}),/нужно приглашение/);assert.equal(await as(ids.third,()=>scalar('select count(*)::int from comm_meetings')),0);
 assert.match(await scalar('select data->>\'text\' from notifications where id=$1',[inv.notification_id??await scalar('select notification_id from comm_invitations where id=$1',[inv.id])]),/МСК/);
});
test('server cron emits one reminder and one start notice, including the organizer, and skips duplicates',async()=>{
 const r=await create(ids.alice,{scheduledAt:new Date(Date.now()+3600000).toISOString(),notifyAll:true});
 await db.query("update comm_meetings set scheduled_at=now()+interval '14 minutes',schedule_updated_at=now()-interval '1 hour',expires_at=now()+interval '8 hours 14 minutes' where id=$1",[r.id]);
 await db.exec('select comm_private.cleanup()');assert.equal(await scalar('select count(*)::int from notifications'),8);await db.exec('select comm_private.cleanup()');assert.equal(await scalar('select count(*)::int from notifications'),8);
 await db.query("update comm_meetings set scheduled_at=now()-interval '1 second' where id=$1",[r.id]);await db.exec('select comm_private.cleanup()');assert.equal(await scalar('select count(*)::int from notifications'),12);await db.exec('select comm_private.cleanup()');assert.equal(await scalar('select count(*)::int from notifications'),12);
 assert.equal((await call(ids.alice,'meeting',{meetingId:r.id})).meeting.canJoin,true);assert.ok((await admit(ids.bob,r.id)).identity);
});
test('only the organizer can reschedule or cancel, notices are idempotent and cancelled rooms never start',async()=>{
 const r=await create(ids.alice,{scheduledAt:new Date(Date.now()+3600000).toISOString(),notifyAll:true});const body={meetingId:r.id,scheduledAt:new Date(Date.now()+2*3600000).toISOString(),requestId:randomUUID()};
 await assert.rejects(call(ids.bob,'schedule',body),/организатор/);const updated=await call(ids.alice,'schedule',body);assert.equal(Date.parse(updated.scheduledAt),Date.parse(body.scheduledAt));assert.deepEqual(await call(ids.alice,'schedule',body),updated);assert.equal(await scalar('select count(*)::int from notifications'),8);
 await assert.rejects(call(ids.bob,'control',{meetingId:r.id,action:'end',requestId:randomUUID()}),/организатору/);
 const end={meetingId:r.id,action:'end',requestId:randomUUID()};await call(ids.alice,'control',end);await call(ids.alice,'control',end);assert.equal((await call(ids.alice,'meeting',{meetingId:r.id})).meeting.phase,'cancelled');assert.equal(await scalar('select count(*)::int from notifications'),12);
 await db.exec('select comm_private.cleanup()');assert.equal(await scalar('select count(*)::int from notifications'),12);await assert.rejects(admit(ids.bob,r.id),/завершена/);
 await assert.rejects(as(ids.bob,()=>scalar('select comm_private.dispatch_v1(\'index\',\'{}\')')),/permission denied/);
});
test('existing public rooms can announce to all once by organizer action, while private rooms stay private',async()=>{
 const r=await create();assert.equal(r.notifyAll,false);assert.ok(!(await call(ids.bob,'index')).meetings.some(item=>item.id===r.id));
 const body={meetingId:r.id,requestId:randomUUID()};await assert.rejects(call(ids.bob,'announce',body),/организатор/);
 const announced=await call(ids.alice,'announce',body);assert.equal(announced.notifyAll,true);await call(ids.alice,'announce',body);await call(ids.alice,'announce',{...body,requestId:randomUUID()});
 assert.equal(await scalar('select count(*)::int from notifications'),4);assert.ok((await call(ids.bob,'index')).meetings.some(item=>item.id===r.id));
 const secret=await create(ids.alice,{inviteOnly:true});await assert.rejects(call(ids.alice,'announce',{meetingId:secret.id,requestId:randomUUID()}),/недоступно/);assert.ok(!(await call(ids.bob,'index')).meetings.some(item=>item.id===secret.id));
});

const saveDoc = (user, mid, version, extra = {}, requestId = randomUUID()) => call(user, 'minutes_save', { meetingId: mid, expectedVersion: version, agenda: '', summary: 'Итоги обсуждения', decisions: '', actions: '', ...extra, requestId });
const documents = (user, mid) => call(user, 'minutes', { meetingId: mid });
const publishDoc = (user, mid, version, requestId = randomUUID()) => call(user, 'minutes_publish', { meetingId: mid, expectedVersion: version, requestId });
const assignDoc = (mid, responsibleId, who = ids.alice, requestId = randomUUID()) => call(who, 'minutes_assign', { meetingId: mid, responsibleId, requestId });
const protocolNoticeCount = () => scalar("select count(*)::int from notifications where data->>'text' like 'Протокол встречи%'");

test('organizer delegates agenda and minutes to an active secretary before a private meeting; organizer retains editing', async () => {
 const r = await create(ids.alice, { inviteOnly: true });
 await assert.rejects(documents(ids.third, r.id), /Нет доступа/);
 const assignment = await assignDoc(r.id, ids.bob); assert.equal(assignment.responsibleId, ids.bob);
 assert.ok((await call(ids.bob, 'index')).meetings.some(m => m.id === r.id));
 const draft = await saveDoc(ids.bob, r.id, 0, { agenda: 'Обсудить план недели', decisions: 'Утвердить даты' });
 assert.equal(draft.canEdit, true); assert.equal(draft.draft.version, 1);
 assert.equal((await documents(ids.alice, r.id)).draft.content.agenda, 'Обсудить план недели');
 await assert.rejects(assignDoc(r.id, ids.third, ids.bob), /назначает организатор/);
 await assert.rejects(saveDoc(ids.head, r.id, 1), /организатору и ответственному/);
 assert.equal(await scalar("select count(*)::int from notifications where user_id=$1 and data->>'text' like 'Вы назначены ответственным%'", [ids.bob]), 1);
});

test('saved agenda is visible to meeting viewers while protocol draft remains private; conflicting edits cannot overwrite', async () => {
 const r = await create(ids.alice, { notifyAll: true });
 const first = await saveDoc(ids.alice, r.id, 0, { agenda: 'Открытая повестка', summary: 'Закрытый черновик' });
 const other = await documents(ids.head, r.id); assert.equal(other.agenda, 'Открытая повестка'); assert.equal(other.draft, null); assert.equal(other.published, null); assert.equal(other.canEdit, false);
 await assert.rejects(saveDoc(ids.alice, r.id, 0, { summary: 'Потерянные правки' }), /Черновик изменён/);
 assert.equal((await documents(ids.alice, r.id)).draft.content.summary, 'Закрытый черновик');
 const same = await saveDoc(ids.alice, r.id, first.draft.version, { agenda: 'Открытая повестка', summary: 'Закрытый черновик' }); assert.equal(same.draft.version, 1);
 await assert.rejects(saveDoc(ids.alice, r.id, 1, { agenda: 'x'.repeat(8001) }), /8000/);
 await assert.rejects(saveDoc(ids.alice, r.id, 1, { decisions: { injected: true } }), /8000/);
 await assert.rejects(as(ids.alice, () => scalar('select count(*) from comm_private.meeting_documents')), /permission denied/);
});

test('minutes survive ending the call and go to actual participants including those who left, not only invitees', async () => {
 const r = await create(); await joined(ids.alice, r.id); await joined(ids.bob, r.id); const third = await joined(ids.third, r.id); await admit(ids.head, r.id);
 await call(ids.third, 'leave', { meetingId: r.id, identity: third.identity });
 await call(ids.alice, 'control', { meetingId: r.id, action: 'end', requestId: randomUUID() });
 await saveDoc(ids.alice, r.id, 0, { decisions: 'Продолжить проект', actions: 'Борис · подготовить отчёт · пятница' });
 const sent = await publishDoc(ids.alice, r.id, 1); assert.equal(sent.published.recipients, 3); assert.equal(await protocolNoticeCount(), 3);
 for (const who of [ids.bob, ids.third]) { const received = await documents(who, r.id); assert.equal(received.draft, null); assert.equal(received.published.content.decisions, 'Продолжить проект'); }
 assert.equal((await documents(ids.head, r.id)).published, null);
 assert.equal(await as(ids.head, () => scalar('select count(*)::int from public.comm_meeting_minutes')), 0);
 assert.equal(await scalar('select count(*)::int from comm_room_messages'), 0);
 const link = await scalar("select data->>'link' from notifications where user_id=$1 and data->>'text' like 'Протокол встречи%'", [ids.third]); assert.equal(link, '#/meetings/' + r.id + '/minutes');
});

test('publication retries are idempotent and new edits create immutable revisions without exposing the new draft', async () => {
 const r = await create(); await joined(ids.bob, r.id); const saveId = randomUUID(), pubId = randomUUID();
 const saved = await saveDoc(ids.alice, r.id, 0, { decisions: 'Решение 1' }, saveId); assert.deepEqual(await saveDoc(ids.alice, r.id, 0, { decisions: 'Решение 1' }, saveId), saved);
 const published = await publishDoc(ids.alice, r.id, 1, pubId); assert.deepEqual(await publishDoc(ids.alice, r.id, 1, pubId), published);
 await publishDoc(ids.alice, r.id, 1); assert.equal(await protocolNoticeCount(), 2); assert.equal(await scalar('select count(*)::int from comm_meeting_minutes'), 1);
 await saveDoc(ids.alice, r.id, 1, { decisions: 'Решение 2' }); assert.equal((await documents(ids.bob, r.id)).published.content.decisions, 'Решение 1');
 await assert.rejects(publishDoc(ids.alice, r.id, 1), /Черновик изменён/);
 const next = await publishDoc(ids.alice, r.id, 2); assert.equal(next.published.revision, 2); assert.equal(await protocolNoticeCount(), 4);
 assert.equal(await scalar("select content->>'decisions' from comm_meeting_minutes where meeting_id=$1 and revision=1", [r.id]), 'Решение 1');
 await assert.rejects(as(ids.bob, () => db.exec("update comm_meeting_minutes set content='{}'")), /permission denied/);
});

test('a late actual join receives the current minutes once; admission, duplicate media events and rejoining do not duplicate', async () => {
 const r = await create(); await saveDoc(ids.alice, r.id, 0); await publishDoc(ids.alice, r.id, 1);
 const grant = await admit(ids.bob, r.id); assert.equal(await protocolNoticeCount(), 1); assert.equal((await documents(ids.bob, r.id)).published, null);
 const event = { meetingId: r.id, identity: grant.identity, event: 'joined', eventId: randomUUID(), at: new Date().toISOString(), sid: 'late-real-sid' };
 await media('event', event); await media('event', event); await media('event', { ...event, eventId: randomUUID() });
 assert.equal((await documents(ids.bob, r.id)).published.revision, 1); assert.equal(await protocolNoticeCount(), 2);
 await call(ids.bob, 'leave', { meetingId: r.id, identity: grant.identity }); await joined(ids.bob, r.id); assert.equal(await protocolNoticeCount(), 2);
});

test('reassignment revokes draft access from previous secretary and removal revokes both editing and published access', async () => {
 const r = await create(); await assignDoc(r.id, ids.bob); await saveDoc(ids.bob, r.id, 0); await joined(ids.bob, r.id); await publishDoc(ids.bob, r.id, 1);
 await assignDoc(r.id, ids.third); assert.equal((await documents(ids.bob, r.id)).draft, null); assert.equal((await documents(ids.third, r.id)).canEdit, true);
 await assert.rejects(saveDoc(ids.bob, r.id, 1), /организатору и ответственному/);
 await call(ids.alice, 'control', { meetingId: r.id, action: 'remove', userId: ids.bob, requestId: randomUUID() });
 await assert.rejects(documents(ids.bob, r.id), /Нет доступа/);
 assert.equal(await as(ids.bob, () => scalar('select count(*)::int from comm_meeting_minutes')), 0);
 await db.query("update profiles set data=data||'{\"active\":false}'::jsonb where id=$1", [ids.third]);
 await assert.rejects(documents(ids.third, r.id), /активную/); await assert.rejects(assignDoc(r.id, ids.third), /активного/);
});

test('protocol delivery excludes removed, pending and inactive accounts and never sends to an unrelated team member', async () => {
 const r = await create(ids.alice, { notifyAll: true }); await joined(ids.bob, r.id); await joined(ids.third, r.id); await joined(ids.head, r.id);
 await call(ids.alice, 'control', { meetingId: r.id, action: 'remove', userId: ids.bob, requestId: randomUUID() });
 await db.query("update profiles set data=data||'{\"pending\":true}'::jsonb where id=$1", [ids.third]); await db.query("update profiles set data=data||'{\"active\":false}'::jsonb where id=$1", [ids.head]);
 await saveDoc(ids.alice, r.id, 0); const sent = await publishDoc(ids.alice, r.id, 1); assert.equal(sent.published.recipients, 1); assert.equal(await protocolNoticeCount(), 1);
 await assert.rejects(as(ids.alice, () => scalar("select comm_private.documents_json($1)", [r.id])), /permission denied/);
 await assert.rejects(as(ids.alice, () => scalar("select comm_private.dispatch_v2('index','{}')")), /permission denied/);
 await assert.rejects(as(ids.alice, () => scalar("select comm_private.media_dispatch_v2('pending','{}')")), /permission denied/);
});

test('empty protocol is rejected and long Unicode protocol is complete on site with an explicit bounded Telegram excerpt', async () => {
 const r = await create(); await saveDoc(ids.alice, r.id, 0, { summary: '', agenda: 'Только повестка' }); await assert.rejects(publishDoc(ids.alice, r.id, 1), /Заполните итоги/);
 const text = '🌍'.repeat(3000); await saveDoc(ids.alice, r.id, 1, { summary: text }); const sent = await publishDoc(ids.alice, r.id, 2);
 assert.equal(sent.published.content.summary, text);
 const notice = await scalar("select data->>'text' from notifications where data->>'text' like 'Протокол встречи%' limit 1"); assert.ok(notice.length < 4000); assert.match(notice, /Полный протокол/);
 assert.equal(await as(null, () => scalar("select has_function_privilege('anon','public.communications(text,jsonb)','EXECUTE')"), 'anon'), false);
});
