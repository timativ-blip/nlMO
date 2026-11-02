// Isolated E2E infrastructure: real PostgreSQL rules + Edge handler + real local LiveKit.
// Auth/Realtime HTTP transport is a test adapter, not an application fallback.
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createCommunicationsHandler, createDistrictDirectoryHandler } from '../.test-communications/communications-entry.js';
const require = createRequire(import.meta.url); const { WebSocketServer } = require('ws');
const port = Number(process.env.COMMUNICATIONS_TEST_PORT ?? 5192), base = `http://127.0.0.1:${port}`;
const origin = 'http://127.0.0.1:5180';
const signing = 'isolated-test-auth-signing-key-not-for-production';
const service = 'isolated-service-key-not-for-production';
const profiles = [
 { id:'00000000-0000-0000-0000-000000000001',name:'Анна Тестовая',role:'head',position:'Организатор',active:true,pending:false,districtId:null },
 { id:'00000000-0000-0000-0000-000000000002',name:'Борис Тестовый',role:'coordinator',position:'Координатор',active:true,pending:false,districtId:'118' },
 { id:'00000000-0000-0000-0000-000000000003',name:'Вера Тестовая',role:'member',position:'Участник команды',active:true,pending:false,districtId:'118' },
 { id:'00000000-0000-0000-0000-000000000004',name:'Денис Без доступа',role:'member',position:'Другой сотрудник',active:true,pending:false,districtId:'119' },
];
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = id => { const data=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600});return data+'.'+createHmac('sha256',signing).update(data).digest('base64url'); };
function subject(token) {
 try { const [head,payload,sig]=token.split('.'), expected=createHmac('sha256',signing).update(head+'.'+payload).digest(), actual=Buffer.from(sig,'base64url');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;const data=JSON.parse(Buffer.from(payload,'base64url'));return data.exp>Date.now()/1000&&profiles.some(profile=>profile.id===data.sub)?data.sub:null; }catch{return null;}
}
const db = new PGlite(); let queue=Promise.resolve();
const serialized=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema extensions;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create schema net;create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer default 5000) returns bigint language sql as $$select 1::bigint$$;");
const initial=readFileSync(new URL('../supabase/migrations/001_init.sql',import.meta.url),'utf8');
await db.exec(initial.slice(initial.indexOf('create table profiles'),initial.indexOf('-- Хранилище вложений')).replace(/select cron\.schedule\([^;]+;/g,'').replace(/alter publication supabase_realtime[^;]+;/g,''));
const daily=readFileSync(new URL('../supabase/migrations/004_roles_registration_daily.sql',import.meta.url),'utf8');
await db.exec(daily.slice(daily.indexOf('create table daily_reports'),daily.indexOf('alter publication supabase_realtime add table daily_reports;')));
await db.exec('create table public.media_briefs(id text primary key,data jsonb,created_at timestamptz default now());create table public.task_templates(id text primary key,data jsonb);create table public.task_schedules(id text primary key,data jsonb);create table public.media_matches(id text primary key,data jsonb);grant usage on schema public to authenticated,anon,service_role;grant select,insert,update on all tables in schema public to authenticated;grant all on all tables in schema public to service_role;grant usage,select on all sequences in schema public to service_role,authenticated;');
await db.exec(readFileSync(new URL('../supabase/migrations/20261102075931_communications_and_meetings.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261102100858_meeting_scheduling_notifications.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261102110233_meeting_minutes.sql',import.meta.url),'utf8'));
for(const profile of profiles){await db.query('insert into auth.users values($1)',[profile.id]);await db.query('insert into public.profiles(id,data) values($1,$2::jsonb)',[profile.id,JSON.stringify({...profile,email:profile.id+'@example.invalid',phone:'',birthdayVisibility:'hidden'})]);}
const tables=['comm_conversations','comm_members','comm_messages','comm_meetings','comm_participants','comm_invitations','comm_room_messages','comm_meeting_minutes','notifications'];
const sockets=new Set();
async function snapshot(){const result={};for(const table of tables){const rows=(await db.query('select * from public.'+table)).rows;result[table]=new Map(rows.map(row=>[row.id??(row.conversation_id??row.meeting_id)+':'+row.user_id,row]));}return result;}
async function runAs(role,uid,sql,args=[]){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid??'']);await db.exec('set role '+role);try{return await db.query(sql,args);}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}}
async function broadcasts(before,after){
 for(const table of tables)for(const [key,record] of after[table]){
  const old=before[table].get(key);if(old&&JSON.stringify(old)===JSON.stringify(record))continue;
  for(const socket of sockets){if(!socket.uid||socket.readyState!==1)continue;for(const sub of socket.subs.values()){
   const matching=sub.filters.filter(filter=>filter.table===table&&(!filter.event||filter.event==='*'||filter.event===(old?'UPDATE':'INSERT')));
   if(!matching.length)continue;
   const allowed=await serialized(async()=>{const sql=record.id?'select 1 from public.'+table+' where id=$1':'select 1 from public.'+table+' where '+(record.conversation_id?'conversation_id':'meeting_id')+'=$1 and user_id=$2';return (await runAs('authenticated',socket.uid,sql,record.id?[record.id]:[record.conversation_id??record.meeting_id,record.user_id])).rows.length>0;});
   if(!allowed)continue;
   const columns=Object.entries(record).map(([name,value])=>({name,type:typeof value==='object'&&value!==null&&!(value instanceof Date)?'jsonb':typeof value==='boolean'?'bool':'text'}));
   socket.send(JSON.stringify({topic:sub.topic,event:'postgres_changes',payload:{ids:matching.map(filter=>filter.id),data:{schema:'public',table,type:old?'UPDATE':'INSERT',commit_timestamp:new Date().toISOString(),columns,record,old_record:old??{},errors:null}},ref:null}));
  }}
 }
}
const admin=createClient(base,service,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const media={url:'ws://127.0.0.1:7880',apiKey:'local-communications',apiSecret:'local-development-fixture-key-not-for-production'};
let directoryNow=Date.now(), directoryName='Петухов Тимофей', directoryFail=false;
const directoryHandler=createDistrictDirectoryHandler(async()=>new Response(directoryFail?'Unavailable':'№округа,Город,Координатор\n121,Красногорск,'+directoryName,{status:directoryFail?502:200}),()=>directoryNow);
await db.query('insert into public.districts(id,data) values($1,$2::jsonb)',['121',JSON.stringify({id:'121',num:121,name:'Красногорский',cities:['Красногорск','Истра'],coordinatorId:null,coordinatorName:'Блюдин Алексей'})]);
const handler=createCommunicationsHandler({admin,userClient:jwt=>createClient(base,'fixture-public-key',{global:{headers:{Authorization:'Bearer '+jwt}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),media,appOrigin:origin,allowLocalMedia:true,hookSecret:async()=> 'local-hook-not-for-production'});
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,base), chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);
 const cors={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','cache-control':'no-store','content-type':'application/json'};
 const reply=(value,status=200)=>{res.writeHead(status,cors);res.end(JSON.stringify(value));};
 if(req.method==='OPTIONS')return reply({});
 const token=(req.headers.authorization??'').replace(/^Bearer\s+/i,''), uid=subject(token), role=token===service?'service_role':uid?'authenticated':'anon';
 try{
  if(url.pathname==='/auth/v1/user'){if(!uid)return reply({message:'Invalid token'},401);const profile=profiles.find(profile=>profile.id===uid);return reply({id:uid,aud:'authenticated',role:'authenticated',email:uid+'@example.invalid',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'});}
  if(url.pathname==='/auth/v1/logout')return reply({});
  if(url.pathname==='/auth/v1/token')return reply({error:'Fixture login uses seeded independent sessions'},400);
  if(url.pathname==='/fixture/directory'&&req.method==='POST'){const change=JSON.parse(raw);if(typeof change.name==='string')directoryName=change.name;directoryFail=!!change.fail;directoryNow+=60001;return reply({ok:true});}
  if(url.pathname==='/functions/v1/media-groups'&&url.searchParams.get('view')==='directory'){const response=await directoryHandler(new Request(url));res.writeHead(response.status,{...cors,...Object.fromEntries(response.headers)});return res.end(await response.text());}
  if(url.pathname.startsWith('/functions/v1/communications')){
   const response=await handler(new Request(url,{method:req.method,headers:req.headers,body:raw.length?raw:undefined,duplex:'half'}));res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
  }
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1);const body=raw.length?JSON.parse(raw):{};
   if(!['communications','communications_media','is_initialized','my_status'].includes(name))return reply({message:'Unexpected RPC'},404);
   const result=await serialized(async()=>{const before=await snapshot();let result;try{result=await runAs(role,uid,name==='is_initialized'?'select public.is_initialized() as data':name==='my_status'?"select jsonb_build_object('exists',true,'active',true,'pending',false) as data":'select public.'+name+'($1,$2::jsonb) as data',name==='communications'||name==='communications_media'?[body.p_action,JSON.stringify(body.p_body??{})]:[]);}catch(error){return{error};}const after=await snapshot();return{data:result.rows[0].data,before,after};});
   if(result.error)return reply({message:result.error.message,code:result.error.code},result.error.code==='42501'?403:400);
   reply(result.data);void broadcasts(result.before,result.after).catch(error=>console.error('Fixture event delivery failed:',error.code??error.name));return;
  }
  if(url.pathname.startsWith('/rest/v1/')){
   const table=url.pathname.split('/').at(-1);if(!/^(profiles|districts|metrics|settings|tasks|events|reports|notifications|telegram_links|daily_reports|media_briefs|audit_log|task_templates|task_schedules|media_matches)$/.test(table))return reply({message:'Unknown fixture table'},404);
   const result=await serialized(async()=>{
    if(req.method==='GET'){let rows=(await runAs(role,uid,'select * from public.'+table)).rows;for(const [key,value] of url.searchParams){if(value.startsWith('eq.'))rows=rows.filter(row=>String(row[key])===value.slice(3));}if(url.searchParams.has('limit'))rows=rows.slice(0,Number(url.searchParams.get('limit')));return rows;}
    const body=JSON.parse(raw);if(req.method==='POST'&&table==='reports'){const data=(await runAs(role,uid,'insert into public.reports(id,data) values($1,$2::jsonb) returning *',[body.id,JSON.stringify(body.data)])).rows;return data;}
    if(req.method==='PATCH'&&table==='notifications'&&url.searchParams.get('id')?.startsWith('eq.'))return (await runAs(role,uid,'update public.notifications set data=$2::jsonb where id=$1 returning *',[url.searchParams.get('id').slice(3),JSON.stringify(body.data)])).rows;
    throw new Error('Unexpected fixture mutation');
   });return reply(result);
  }
  if(url.pathname==='/fixture/accounts'){return reply(profiles.map(profile=>({id:profile.id,name:profile.name,token:tokenFor(profile.id)})));}
  return reply({message:'Not found'},404);
 }catch(error){return reply({message:error.message,code:error.code??'fixture'},400);}
});
const wss=new WebSocketServer({server,path:'/realtime/v1/websocket'});
wss.on('connection',socket=>{sockets.add(socket);socket.subs=new Map();socket.on('close',()=>sockets.delete(socket));socket.on('message',raw=>{
 let message;try{message=JSON.parse(String(raw));}catch{return;}const {topic,event,payload,ref,join_ref}=message;
 const reply=(status,response={})=>socket.send(JSON.stringify({topic,event:'phx_reply',payload:{status,response},ref,join_ref}));
 if(event==='heartbeat')return reply('ok');
 if(event==='phx_join'){
  const uid=subject(payload.access_token);if(!uid)return reply('error',{reason:'unauthorized'});socket.uid=uid;
  const filters=(payload.config?.postgres_changes??[]).map((filter,index)=>({...filter,id:index+1}));socket.subs.set(topic,{topic,filters});return reply('ok',{postgres_changes:filters});
 }
 if(event==='phx_leave'){socket.subs.delete(topic);return reply('ok');}
 if(event==='access_token'){const uid=subject(payload.access_token);if(uid)socket.uid=uid;return;}
});});
server.listen(port,'127.0.0.1',()=>console.log('Isolated communication fixture listening on '+base));
const close=()=>{for(const socket of sockets)socket.close();wss.close();server.close();void db.close().then(()=>process.exit(0));};process.once('SIGTERM',close);process.once('SIGINT',close);
