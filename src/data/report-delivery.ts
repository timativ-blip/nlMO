import { acceptReportRecord, getPhase, getState, saveDaily, saveReport, sendReport } from './store';
import { AUTH_STORAGE_KEY, BACKEND, sb } from '../lib/supabase';
import { withDeadline } from '../lib/deadline';
import { clearSavedDraft, draftKey } from '../lib/drafts';
import { enqueueReport, flushReportQueue, reportOwner, type ReportFields, type ReportInput, type ReportOperation, type ReportReply } from '../lib/report-queue';
import type { DailyReport, Report } from './types';
export const REPORT_SCOPE=BACKEND?AUTH_STORAGE_KEY:'demo';
export const currentReportOwner=()=>reportOwner(REPORT_SCOPE,getState().session.userId);
export async function queueReport(input:Omit<ReportInput,'userId'>){
 const s=getState(),me=s.users.find(u=>u.id===s.session.userId);
 if(!me?.active||me.pending||me.role==='member')throw new Error('Войдите в рабочий кабинет перед заполнением отчёта.');
 if(Object.values(input.fields).some(v=>typeof v!=='string'||v.length>30000))throw new Error('Каждое поле должно содержать не более 30 000 символов.');
 const op=await enqueueReport(reportOwner(REPORT_SCOPE,me.id),{...input,userId:me.id});
 window.dispatchEvent(new Event('kc-report-enqueued'));return op;
}
function demoSend(op:ReportOperation):ReportReply{
 const s=getState();const old=op.kind==='daily'?s.dailyReports.find(r=>r.userId===op.userId&&r.day===op.day):s.reports.find(r=>r.id===op.reportId);
 if((old?.updatedAt??null)!==op.baseRevision)return {ok:false,kind:'conflict',server:old,message:'Отчёт изменился с другого устройства. Сравните версии.'};
 if(op.kind==='daily')saveDaily({day:op.day!,...op.fields as Required<Pick<ReportFields,'done'|'plan'|'problems'>>});
 else {saveReport(op.reportId!,op.fields as Pick<Report,'conclusions'|'problems'|'plan'>);if(op.intent==='send')sendReport(op.reportId!);}
 const next=getState();return {ok:true,record:op.kind==='daily'?next.dailyReports.find(r=>r.userId===op.userId&&r.day===op.day):next.reports.find(r=>r.id===op.reportId)};
}
export function acknowledgeReportDraft(op:ReportOperation,record:DailyReport|Report){
 const key=draftKey(REPORT_SCOPE,op.userId,op.entity);
 try{clearSavedDraft(key,op.fields,localStorage);}catch{/* Confirmed data remains in the queue and on the server. */}
 window.dispatchEvent(new CustomEvent('kc-draft-confirmed',{detail:{key,value:op.fields,revision:record.updatedAt}}));
}
let flushing=false;
const lease=crypto.randomUUID();
export async function deliverReports(){
 if(flushing)return;
 const uid=getState().session.userId,owner=reportOwner(REPORT_SCOPE,uid);
 const canSend=()=>getState().session.userId===uid&&getPhase().phase==='ready'&&navigator.onLine!==false;
 if(!uid||!canSend())return;
 flushing=true;
 try{await flushReportQueue({owner,lease,canSend,send:async op=>{
  if(!BACKEND)return demoSend(op);
  const {data:session,error:authError}=await withDeadline(()=>sb!.auth.getSession(),10000,'Сервер не ответил вовремя');
  if(authError)throw authError;
  if(session.session?.user.id!==op.userId||!canSend())return {ok:false,kind:'blocked',message:'Для отправки войдите в тот же аккаунт, в котором заполнен отчёт.'};
  const body={id:op.id,userId:op.userId,kind:op.kind,intent:op.intent,day:op.day,reportId:op.reportId,districtId:op.districtId,weekStart:op.weekStart,fields:op.fields,baseRevision:op.baseRevision};
  const {data,error}=await withDeadline(signal=>sb!.rpc('save_queued_report',{p_body:body}).abortSignal(signal),20000,'Сервер не ответил вовремя');
  if(error)throw error;return data as ReportReply;
 },ack:(op,record)=>{if(getState().session.userId!==uid)return;const current=op.kind==='daily'?getState().dailyReports.find(r=>r.id===record.id):getState().reports.find(r=>r.id===record.id);if(!current||Date.parse(current.updatedAt)<=Date.parse(record.updatedAt))acknowledgeReportDraft(op,record);acceptReportRecord(op.kind,record);}});
 }finally{flushing=false;}
}
