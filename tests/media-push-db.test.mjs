import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
let db;const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002',c='00000000-0000-0000-0000-000000000003';
const rows=async(q,args=[])=>(await db.query(q,args)).rows;
async function as(uid,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
async function device(uid,muted=[]){return(await rows("insert into push_subscriptions(user_id,endpoint,subscription,muted) values($1,$2,'{}',$3) returning id",[uid,'https://fcm.googleapis.com/'+uid+Math.random(),muted]))[0].id;}
async function notice(id='test',uid=a,kind='report'){await db.query('insert into notifications(id,user_id,data) values($1,$2,$3)',[id,uid,{id,kind,text:'Test',read:false,link:'#/daily'}]);}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema extensions;create schema net;create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer default 5000) returns bigint language sql as $$select 1::bigint$$;
 create table profiles(id uuid primary key,data jsonb);create table notifications(id text primary key,user_id uuid references profiles(id),data jsonb,created_at timestamptz default now());create table app_secrets(key text primary key,value text);create table tasks(id text primary key,data jsonb);create table reports(id text primary key,data jsonb);create table daily_reports(user_id uuid,day text);create function msk_today() returns text language sql as $$select to_char(now() at time zone 'Europe/Moscow','YYYY-MM-DD')$$;`);
 const sql=readFileSync(new URL('../supabase/migrations/20261116070515_web_push_and_smart_reminders.sql',import.meta.url),'utf8').replace(/select cron\.schedule\([^;]+;/g,'');await db.exec(sql);
 for(const[id,role]of[[a,'coordinator'],[b,'staff'],[c,'coordinator']])await db.query('insert into profiles values($1,$2)',[id,{id,role,districtId:id===c?'122':'121',active:true}]);
});
after(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('truncate push_deliveries,push_subscriptions,notifications,tasks,reports,daily_reports cascade');await db.query("update profiles set data=data-'pending'");});
test('RLS isolates devices and clients cannot register devices or claim the dispatch queue directly',async()=>{
 await device(a);await device(b);assert.equal((await as(a,()=>rows('select * from push_subscriptions'))).length,1);
 await assert.rejects(as(a,()=>rows('select * from claim_push_deliveries()')),/permission denied/);
 await assert.rejects(as(a,()=>rows("insert into push_subscriptions(user_id,endpoint,subscription) values($1,'https://x','{}')",[b])),/permission denied/);
 assert.equal((await as(a,()=>rows('delete from push_subscriptions where user_id=$1 returning id',[b]))).length,0);
});
test('notification fanout honors kind preferences, ownership, pending users and retry leases',async()=>{
 const s=await device(a);await device(a,['report']);await device(b);await notice();
 assert.equal((await rows('select * from push_deliveries')).length,1);
 const first=await rows('select * from claim_push_deliveries()');assert.equal(first.length,1);assert.equal(first[0].subscription_id,s);assert.equal(first[0].attempts,1);assert.equal(first[0].enabled,true);
 assert.equal((await rows('select * from claim_push_deliveries()')).length,0);
 await db.exec("update push_deliveries set locked_until=now()-interval '1 second'");await db.query("update profiles set data=data||'{\"pending\":true}' where id=$1",[a]);
 const retried=await rows('select * from claim_push_deliveries()');assert.equal(retried[0].attempts,2);assert.equal(retried[0].enabled,false);
});
test('daily and weekly reminders exclude submitted work and remain unique when run twice',async()=>{
 const today=(await rows('select msk_today() as day'))[0].day;
 await db.query('insert into daily_reports values($1,$2)',[b,today]);await db.exec('select daily_report_reminders();select daily_report_reminders()');
 const day=new Date(today+'T12:00Z').getUTCDay();const daily=await rows("select user_id,data->>'text' as text from notifications where id like 'dr_%'");
 assert.equal(daily.length,day===0||day===6?0:2);assert.equal(daily.some(n=>n.user_id===b),false);if(daily.length===2)assert.notEqual(daily[0].text,daily[1].text);
 const ws=(await rows("select to_char((now() at time zone 'Europe/Moscow')::date-(extract(isodow from now() at time zone 'Europe/Moscow')::int-1)-case when extract(isodow from now() at time zone 'Europe/Moscow')=1 then 7 else 0 end,'YYYY-MM-DD') as ws"))[0].ws;
 await db.query('insert into reports values($1,$2)',['r',{districtId:'121',weekStart:ws,status:'submitted'}]);
 await db.exec('select app_private.weekly_report_reminders();select app_private.weekly_report_reminders()');
 const weekly=await rows("select user_id from notifications where id like 'wr_%'");assert.deepEqual(weekly.map(n=>n.user_id),[c]);
});
test("daily reminders include the developer and send one item per day",async()=>{
 const d="00000000-0000-0000-0000-000000000009";
 await db.query("insert into profiles values($1,$2)",[d,{id:d,role:"head",title:"developer",active:true}]);
 try {
  await db.exec(readFileSync(new URL("../supabase/migrations/20261118090400_report_reminders_for_leadership.sql",import.meta.url),"utf8"));
  const today=(await rows("select msk_today() as day"))[0].day;
  await db.exec("select daily_report_reminders();select daily_report_reminders()");
  const weekday = new Date(today+"T12:00Z").getUTCDay();
  assert.equal((await rows("select * from notifications where user_id=$1",[d])).length,Number(weekday>0&&weekday<6));
 } finally {
  await db.query("delete from notifications where user_id=$1",[d]);
  await db.query("delete from profiles where id=$1",[d]);
 }
});
test('deadline reminders cover co-assignees and do not duplicate when cron retries',async()=>{
 const today=(await rows('select msk_today() as day'))[0].day;
 await db.query('insert into tasks values($1,$2)',['t',{title:'Проверить материалы',status:'new',due:today,assigneeId:a,coAssigneeIds:[b]}]);
 await db.exec('select deadline_reminders();select deadline_reminders()');const n=await rows('select user_id,data from notifications order by user_id');
 assert.deepEqual(n.map(x=>x.user_id),[a,b]);assert.match(n[0].data.text,/Проверить материалы/);assert.equal(n[0].data.text.includes('%s'),false);
});
