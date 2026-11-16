import type { DailyReport, Report, User, District } from '../data/types';
export interface ReportFields { plan:string; problems:string; done?:string; conclusions?:string }
export interface ReportInput { kind:'daily'|'weekly'; userId:string; day?:string; reportId?:string; districtId?:string; weekStart?:string; intent:'save'|'send'; fields:ReportFields; baseRevision:string|null }
export type QueueStatus='queued'|'sending'|'sent'|'conflict'|'blocked';
export interface ReportOperation extends ReportInput { id:string; owner:string; entity:string; status:QueueStatus; createdAt:number; attempts:number; nextAttempt:number; lease?:string; leaseUntil?:number; error?:string; server?:DailyReport|Report|null }
export interface OfflineSnapshot { owner:string; user:User; districts:District[]; dailyReports:DailyReport[]; reports:Report[]; verifiedAt:number }
const DB='kc-report-queue-v1';
let opened:Promise<IDBDatabase>|undefined;
const listeners=new Set<()=>void>();let broadcast:BroadcastChannel|undefined;
const req=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error??new Error('Хранилище недоступно.'));});
export const reportOwner=(scope:string,userId:string)=>`${scope}:${userId}`;
export const reportEntity=(input:ReportInput)=>input.kind==='daily'?`daily:${input.day}`:`report:${input.reportId}`;
export const subscribeReportQueue=(fn:()=>void)=>{listeners.add(fn);if(typeof BroadcastChannel!=='undefined'&&!broadcast){broadcast=new BroadcastChannel('kc-report-queue');broadcast.onmessage=()=>listeners.forEach(f=>f());}return()=>listeners.delete(fn);};
function changed(){listeners.forEach(f=>f());broadcast?.postMessage('changed');}
async function db(){
 if(!opened)opened=new Promise<IDBDatabase>((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('Браузер не разрешил сохранение на устройстве.'));return;}
  const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result;const o=d.createObjectStore('operations',{keyPath:'id'});o.createIndex('owner','owner');o.createIndex('entity',['owner','entity']);d.createObjectStore('snapshots',{keyPath:'owner'});};
  r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opened=undefined;};resolve(r.result);};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Закройте старую вкладку приложения и повторите сохранение.'));
 }).catch(e=>{opened=undefined;throw e;});
 return opened;
}
async function transaction<T>(store:string,mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>Promise<T>){
 const d=await db(),t=d.transaction(store,mode),complete=new Promise<void>((resolve,reject)=>{t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error??new Error('Не удалось сохранить на устройстве.'));t.onabort=()=>reject(t.error??new Error('Сохранение отменено.'));});
 try{const result=await fn(t.objectStore(store));await complete;return result;}catch(e){try{t.abort();}catch{}await complete.catch(()=>{});throw e;}
}
export async function reportOperations(owner:string){return transaction('operations','readonly',async s=>(await req(s.index('owner').getAll(owner)) as ReportOperation[]).sort((a,b)=>b.createdAt-a.createdAt));}
export async function enqueueReport(owner:string,input:ReportInput,now=Date.now()){
 const operation=await transaction('operations','readwrite',async s=>{
  const entity=reportEntity(input),existing=(await req(s.index('entity').getAll([owner,entity])) as ReportOperation[]).find(o=>o.status!=='sent');
  if(existing){
   if(JSON.stringify(existing.fields)===JSON.stringify(input.fields)&&existing.intent===input.intent)return existing;
   if(existing.status!=='queued'||existing.attempts>0)throw new Error('Предыдущая версия ещё не подтверждена. Откройте очередь отправки перед сохранением новой версии.');
   await req(s.delete(existing.id));
  }
  const row:ReportOperation={...input,id:crypto.randomUUID(),owner,entity,status:'queued',createdAt:now,attempts:0,nextAttempt:now};await req(s.put(row));return row;
 });changed();return operation;
}
export async function claimReport(owner:string,lease:string,now=Date.now()){
 const operation=await transaction('operations','readwrite',async s=>{
  const rows=(await req(s.index('owner').getAll(owner)) as ReportOperation[]).sort((a,b)=>a.createdAt-b.createdAt);
  const row=rows.find(o=>o.status==='queued'&&o.nextAttempt<=now||o.status==='sending'&&(o.leaseUntil??0)<now);
  if(!row)return null;
  const next={...row,status:'sending' as const,lease,leaseUntil:now+45000,attempts:row.attempts+1};await req(s.put(next));return next;
 });if(operation)changed();return operation;
}
export async function settleReport(id:string,lease:string,patch:Partial<Pick<ReportOperation,'status'|'error'|'server'|'nextAttempt'>>){
 const row=await transaction('operations','readwrite',async s=>{const old=await req(s.get(id)) as ReportOperation|undefined;if(!old||old.status!=='sending'||old.lease!==lease)return null;const next={...old,...patch,lease:undefined,leaseUntil:undefined};await req(s.put(next));return next;});if(row)changed();return row;
}
export async function retryReport(owner:string,id:string){
 await transaction('operations','readwrite',async s=>{const row=await req(s.get(id)) as ReportOperation|undefined;if(!row||row.owner!==owner||row.status==='sent'||row.status==='sending')return;await req(s.put({...row,status:'queued',nextAttempt:Date.now(),error:undefined}));});changed();
}
export async function removeReportOperation(owner:string,id:string){
 await transaction('operations','readwrite',async s=>{const row=await req(s.get(id)) as ReportOperation|undefined;if(row?.owner===owner&&row.status!=='sending')await req(s.delete(id));});changed();
}
export async function resolveReportConflict(owner:string,id:string){
 const row=await transaction('operations','readwrite',async s=>{
  const old=await req(s.get(id)) as ReportOperation|undefined;if(!old||old.owner!==owner||old.status!=='conflict')throw new Error('Конфликт уже изменился. Обновите очередь.');
  const next={...old,id:crypto.randomUUID(),status:'queued' as const,baseRevision:old.server?.updatedAt??null,server:undefined,error:undefined,attempts:0,nextAttempt:Date.now(),createdAt:Date.now(),lease:undefined,leaseUntil:undefined};
  await req(s.delete(id));await req(s.put(next));return next;
 });changed();return row;
}
export async function saveOfflineSnapshot(snapshot:OfflineSnapshot){await transaction('snapshots','readwrite',async s=>{await req(s.put(snapshot));});}
export async function readOfflineSnapshot(owner:string,now=Date.now()){
 const snapshot=await transaction('snapshots','readonly',s=>req(s.get(owner))) as OfflineSnapshot|undefined;
 return snapshot&&snapshot.owner===owner&&snapshot.verifiedAt<=now&&now-snapshot.verifiedAt<7*86400000?snapshot:null;
}
export function transientReportError(error:unknown){
 const e=error as {name?:string;message?:string;status?:number};
 return e?.name==='RequestTimeoutError'||e?.name==='AbortError'||[0,408,429,502,503,504].includes(e?.status??-1)||/failed to fetch|fetch failed|networkerror|network request|load failed|offline|нет связи|не ответил вовремя|не удалось дождаться/i.test(e?.message??'');
}
export interface ReportReply { ok:boolean; record?:DailyReport|Report; kind?:'conflict'|'blocked'|'validation'; message?:string; server?:DailyReport|Report|null }
export async function flushReportQueue(deps:{owner:string;lease:string;canSend:()=>boolean;send:(operation:ReportOperation)=>Promise<ReportReply>;ack:(operation:ReportOperation,record:DailyReport|Report)=>void|Promise<void>;now?:()=>number}){
 const now=deps.now??Date.now;
 for(let i=0;i<30&&deps.canSend();i++){
  const op=await claimReport(deps.owner,deps.lease,now());if(!op)return;
  try{
   if(!deps.canSend()){await settleReport(op.id,deps.lease,{status:'queued',nextAttempt:now()});return;}
   const reply=await deps.send(op);
   if(reply.ok&&reply.record){const settled=await settleReport(op.id,deps.lease,{status:'sent',error:undefined});if(settled)await deps.ack(op,reply.record);}
   else await settleReport(op.id,deps.lease,{status:reply.kind==='conflict'?'conflict':'blocked',error:reply.message??'Сервер не принял отчёт. Проверьте данные.',server:reply.server});
  }catch(error){
   const retry=transientReportError(error);await settleReport(op.id,deps.lease,{status:retry?'queued':'blocked',error:retry?'Нет подтверждения сервера. Повторим отправку при восстановлении связи.':(error as Error).message,nextAttempt:now()+Math.min(300000,10000*2**Math.min(op.attempts,5))});if(retry)return;
  }
 }
}
