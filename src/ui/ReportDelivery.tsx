import { CheckCircle2, CloudOff, CloudUpload, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { currentReportOwner, deliverReports } from '../data/report-delivery';
import { getPhase, reconnectReports, useAppState, usePhase } from '../data/store';
import { reportOperations, removeReportOperation, resolveReportConflict, retryReport, subscribeReportQueue, type ReportOperation } from '../lib/report-queue';
import { fmtDayMonth, fmtStamp } from '../lib/date';
import { Button, Modal, toast } from './kit';
const labels={queued:'Ждёт отправки',sending:'Отправляется',sent:'Подтверждено сервером',conflict:'Нужно сравнить версии',blocked:'Требуется действие'};
export function useReportOperations(){
 const uid=useAppState().session.userId;const [rows,setRows]=useState<ReportOperation[]>([]),[error,setError]=useState('');
 useEffect(()=>{let alive=true;const owner=currentReportOwner();const load=()=>{void reportOperations(owner).then(value=>{if(alive){setRows(value);setError('');}},()=>{if(alive)setError('Хранилище на устройстве недоступно. Не закрывайте заполненный отчёт.');});};load();const unsub=subscribeReportQueue(load);return()=>{alive=false;unsub();};},[uid]);
 return {rows,error};
}
export function ReportDeliveryEngine(){
 const {phase}=usePhase();const uid=useAppState().session.userId;
 useEffect(()=>{
  const run=()=>{if(navigator.onLine===false)return;if(getPhase().phase==='offline')void reconnectReports();else void deliverReports().catch(()=>{});};
  run();const timer=setInterval(run,30000);
  window.addEventListener('online',run);window.addEventListener('focus',run);window.addEventListener('kc-report-enqueued',run);
  return()=>{clearInterval(timer);window.removeEventListener('online',run);window.removeEventListener('focus',run);window.removeEventListener('kc-report-enqueued',run);};
 },[phase,uid]);return null;
}
export function ReportDeliveryStatus({entity,always=false}:{entity?:string;always?:boolean}){
 const {rows,error}=useReportOperations();const [open,setOpen]=useState(false);const [online,setOnline]=useState(navigator.onLine!==false);
 useEffect(()=>{const change=()=>setOnline(navigator.onLine!==false);window.addEventListener('online',change);window.addEventListener('offline',change);return()=>{window.removeEventListener('online',change);window.removeEventListener('offline',change);};},[]);
 const relevant=rows.filter(r=>!entity||r.entity===entity),pending=relevant.filter(r=>r.status!=='sent'),last=relevant[0];
 const title=error||(!online?'Нет связи · отчёты можно заполнить':pending.length?`Отчёты без подтверждения: ${pending.length}`:last?'Сервер подтвердил сохранение':'Очередь отчётов пуста');
 if(!always&&!entity&&!pending.length&&online&&!error)return null;
 const action=async(fn:()=>Promise<unknown>)=>{try{await fn();void deliverReports().catch(()=>{});}catch(e){toast((e as Error).message,'error');}};
 return <>
  <div className={`report-delivery-status ${pending.some(r=>['blocked','conflict'].includes(r.status))||error?'needs-action':''}`} role="status">
   {error||!online?<CloudOff size={17}/>:pending.length?<CloudUpload size={17}/>:<CheckCircle2 size={17}/>}<span className="grow">{title}</span><Button size="sm" variant="ghost" onClick={()=>setOpen(true)}>Открыть очередь</Button>
  </div>
  <Modal open={open} onClose={()=>setOpen(false)} title="Отправка отчётов" width={820}>
   <p className="small muted">Текст хранится на этом устройстве до подтверждения сервера. Отправка возобновляется, когда приложение открыто и есть связь. Если приложение закрыто — при следующем открытии. Очередь привязана к вашему аккаунту.</p>
   {error&&<div className="callout danger">{error}</div>}
   {!relevant.length&&<p className="muted">Нет отчётов в очереди.</p>}
   <div className="col" style={{gap:14}}>{relevant.slice(0,40).map(op=><article className="card card-pad col" style={{gap:10}} key={op.id}>
    <div className="row wrap"><b className="grow">{op.kind==='daily'?`Отчёт дня · ${fmtDayMonth(op.day!)}`:`Недельный отчёт · ${fmtDayMonth(op.weekStart!)}`}</b><span className={`badge ${op.status==='sent'?'st-done':'st-review'}`}>{labels[op.status]}</span></div>
    <span className="small muted">Сохранён на устройстве {fmtStamp(new Date(op.createdAt).toISOString())}{op.intent==='save'&&op.kind==='weekly'?' · черновик':' · на отправку'}</span>
    {op.error&&<div className="callout warn">{op.error}</div>}
    <details><summary>Сохранённый текст{op.status==='conflict'?' и версия сервера':''}</summary><div className={op.status==='conflict'?'report-version-grid':'col'}>
     <ReportVersion title="На устройстве" fields={op.fields}/>{op.status==='conflict'&&<ReportVersion title="На сервере" fields={op.server}/>}</div></details>
    {op.status==='conflict'?<div className="col" style={{gap:8}}><span className="small muted">«Отправить мой текст» заменит текст на сервере после повторной проверки прав. Если серверная версия снова изменится, приложение снова предложит сравнение.</span><div className="row wrap"><Button size="sm" onClick={()=>void action(()=>resolveReportConflict(op.owner,op.id))}>Отправить мой текст</Button><Button size="sm" variant="ghost" onClick={()=>void action(()=>removeReportOperation(op.owner,op.id))}>Убрать мою отправку</Button></div></div>
     :op.status!=='sent'&&op.status!=='sending'&&<div className="row wrap"><Button size="sm" icon={RefreshCw} onClick={()=>void action(()=>retryReport(op.owner,op.id))}>Повторить</Button><Button size="sm" variant="ghost" onClick={()=>void action(()=>removeReportOperation(op.owner,op.id))}>{op.attempts?'Остановить повторные попытки':'Убрать из очереди'}</Button></div>}
    {op.attempts>0&&op.status!=='sent'&&<span className="small muted">Остановка повторных попыток не отменяет запись, если сервер уже успел её принять. Текст формы останется в черновике.</span>}
   </article>)}</div>
  </Modal>
 </>;
}
function ReportVersion({title,fields}:{title:string;fields?:{done?:string;conclusions?:string;plan?:string;problems?:string}|null}){return <div className="report-version"><h3>{title}</h3>{!fields?<p className="muted">Записи нет</p>:Object.entries({done:'Что сделано',conclusions:'Выводы',plan:'План',problems:'Проблемы'}).filter(([key])=>key in fields).map(([key,label])=><div key={key}><b className="small">{label}</b><p>{fields[key as keyof typeof fields]||'—'}</p></div>)}</div>;}
