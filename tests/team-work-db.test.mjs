import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
let db,day,ws;const head='00000000-0000-0000-0000-000000000001',coord='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003',staff='00000000-0000-0000-0000-000000000004';
const sql=file=>readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
const scalar=async(q,args=[])=>(Object.values((await db.query(q,args)).rows[0])[0]);
async function as(uid,fn){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid??'']);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}}
const call=(uid,body)=>as(uid,()=>scalar('select save_queued_report($1)',[body]));
const daily=(extra={})=>({id:randomUUID(),userId:coord,kind:'daily',intent:'save',day,baseRevision:null,fields:{done:'Провели встречу с жителями',plan:'Подготовить материалы',problems:''},...extra});
const weekly=(extra={})=>({id:randomUUID(),userId:coord,kind:'weekly',intent:'send',reportId:`r_121_${ws}`,districtId:'121',weekStart:ws,baseRevision:null,fields:{conclusions:'Задачи недели выполнены',problems:'',plan:'Продолжить работу'},...extra});
before(async()=>{
 db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema extensions;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema net;create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer default 5000) returns bigint language sql as $$select 1::bigint$$;");
 const init=sql('001_init.sql');await db.exec(init.slice(init.indexOf('create table profiles'),init.indexOf('-- Хранилище вложений')).replace(/select cron\.schedule\([^;]+;/g,'').replace(/alter publication supabase_realtime[^;]+;/g,''));
 const daily=sql('004_roles_registration_daily.sql');await db.exec(daily.slice(0,daily.indexOf('-- Напоминание в 18:00')).replace(/alter publication supabase_realtime[^;]+;/g,''));
 await db.exec(sql('20261116095159_quality_and_offline_reports.sql'));
 await db.exec('grant usage on schema public to authenticated;grant select,insert,update on profiles,districts,tasks,reports,daily_reports,notifications to authenticated;grant usage on all sequences in schema public to authenticated;');
 for(const [id,role,district] of [[head,'head',null],[coord,'coordinator','121'],[other,'coordinator','122'],[staff,'staff',null]]){
 await db.query('insert into auth.users values($1)',[id]);await db.query('insert into profiles(id,data) values($1,$2)',[id,{id,name:'Тестовый сотрудник',role,districtId:district,active:true,pending:false}]);}
 await db.exec(`insert into districts values('121','{"id":"121","name":"Округ"}'),('122','{"id":"122","name":"Другой округ"}')`);
 day=await scalar('select msk_today()');ws=await scalar("select to_char(date_trunc('week',now() at time zone 'Europe/Moscow'),'YYYY-MM-DD')");
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec("truncate app_private.report_operations,notifications,daily_reports,reports,tasks;update profiles set data=data||'{\"active\":true,\"pending\":false}'");});
test('daily retries after lost responses are idempotent and private',async()=>{
 const body=daily();const a=await call(coord,body),b=await call(coord,body);assert.equal(a.ok,true);assert.deepEqual(a,b);assert.equal(await scalar('select count(*) from daily_reports'),1);assert.equal(await scalar('select count(*) from app_private.report_operations'),1);
 await assert.rejects(call(coord,{...body,fields:{...body.fields,done:'Изменённая отправленная версия'}}),/Нельзя изменить/);
 await assert.rejects(as(coord,()=>scalar('select count(*) from app_private.report_operations')),/permission denied/);
});
test('revision conflicts preserve remote text and may be resolved with a new id',async()=>{
 const a=await call(coord,daily());const b=await call(coord,daily({fields:{done:'Вторая версия с устройства',plan:'',problems:''}}));assert.equal(b.kind,'conflict');assert.equal(b.server.done,a.record.done);
 const fixed=await call(coord,daily({baseRevision:b.server.updatedAt,fields:{done:'Вторая версия с устройства',plan:'',problems:''}}));assert.equal(fixed.ok,true);assert.equal(fixed.record.done,'Вторая версия с устройства');
});
test('weekly text and sending are atomic; retries do not duplicate notifications or history',async()=>{
 const body=weekly();const a=await call(coord,body);assert.equal(a.ok,true);assert.equal(a.record.status,'sent');assert.equal(a.record.history.length,1);assert.equal(a.record.conclusions,body.fields.conclusions);
 await call(coord,body);assert.equal(await scalar('select count(*) from notifications'),1);
 const b=await call(coord,weekly({intent:'save',baseRevision:a.record.updatedAt,fields:{conclusions:'Пытаемся изменить',plan:'',problems:''}}));assert.equal(b.kind,'conflict');assert.equal(await scalar("select data->>'status' from reports"),'sent');
});
test('server rechecks actual actor, active status, role and district',async()=>{
 assert.equal((await call(other,daily())).ok,false);assert.equal((await call(staff,weekly({userId:staff}))).ok,false);assert.equal((await call(other,weekly({userId:other}))).ok,false);
 await db.query("update profiles set data=data||'{\"active\":false}' where id=$1",[coord]);assert.equal((await call(coord,daily())).ok,false);
});
test('closed dates, future dates, oversized text and incomplete sends remain unsent',async()=>{
 assert.equal((await call(coord,daily({day:'2020-01-01'}))).ok,false);assert.equal((await call(coord,daily({day:'2099-01-01'}))).ok,false);
 await assert.rejects(call(coord,daily({fields:{done:'short',plan:'',problems:''}})),/Опишите/);
 await assert.rejects(call(coord,daily({fields:{done:'x'.repeat(30001),plan:'',problems:''}})),/30 000/);
 await assert.rejects(call(coord,weekly({fields:{conclusions:'',plan:'',problems:''}})),/Заполните/);assert.equal(await scalar('select count(*) from reports'),0);
});
const t=()=>({id:'t',title:'Задача теста',districtId:'121',authorId:head,assigneeId:staff,coAssigneeIds:[],status:'review',comments:[],checklist:[],history:[],attachments:[],result:{text:'Выполнено'},createdAt:new Date().toISOString()});
const createTask=()=>db.query('insert into tasks values($1,$2)',['t',t()]);
const changeTask=(uid,comment,status='in_progress')=>as(uid,()=>db.query("update tasks set data=data||jsonb_build_object('status',$1::text,'comments',$2::jsonb) where id='t' returning data",[status,[comment]]));
const c=(extra={})=>({id:randomUUID(),authorId:coord,at:'2020-01-01',kind:'return',text:'Нужно исправить результат',reworkReason:'accuracy',...extra});
test('only a genuine review return produces server-stamped quality evidence',async()=>{
 await createTask();const result=await changeTask(coord,c());const comment=result.rows[0].data.comments[0];assert.equal(comment.reworkReason,'accuracy');assert.notEqual(comment.at,'2020-01-01');
 await assert.rejects(as(coord,()=>db.query("update tasks set data=jsonb_set(data,'{comments,0,text}','\"Изменяем историю\"') where id='t'")),/Комментарии нельзя/);
});
test('old clients keep working with an unspecified reason; fabricated events are rejected',async()=>{
 await createTask();const old=c();delete old.reworkReason;assert.equal((await changeTask(coord,old)).rows[0].data.comments[0].reworkReason,'unspecified');
 await db.exec('truncate tasks');await createTask();await assert.rejects(changeTask(coord,c(),'review'),/Возврат возможен/);assert.equal((await changeTask(other,c({authorId:other}))).rows.length,0);await assert.rejects(changeTask(coord,c({reworkReason:'invented'})),/Выберите причину/);
});

test('sent weekly reports do not get missing-report reminders',async()=>{
 const reminderWeek=await scalar("select to_char((now() at time zone 'Europe/Moscow')::date-(extract(isodow from now() at time zone 'Europe/Moscow')::int-1)-case when extract(isodow from now() at time zone 'Europe/Moscow')=1 then 7 else 0 end,'YYYY-MM-DD')");
 await call(coord,weekly({weekStart:reminderWeek,reportId:`r_121_${reminderWeek}`}));
 await db.exec('truncate notifications;select app_private.weekly_report_reminders();select app_private.weekly_report_reminders()');
 const notices=(await db.query("select user_id from notifications where id like 'wr_%'")).rows;assert.deepEqual(notices.map(n=>n.user_id),[other]);
});
