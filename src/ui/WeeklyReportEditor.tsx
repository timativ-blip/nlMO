import { Save, Send } from 'lucide-react';
import { useState } from 'react';
import { queueReport } from '../data/report-delivery';
import type { Report } from '../data/types';
import { DraftNotice, useDraft } from './drafts';
import { Button, Field, Textarea, toast } from './kit';
import { ReportDeliveryStatus, useReportOperations } from './ReportDelivery';
export function WeeklyReportEditor({report:r}:{report:Report}){
 const draft=useDraft(`report:${r.id}`,{conclusions:r.conclusions,problems:r.problems,plan:r.plan},r.updatedAt);
 const v=draft.value;const [busy,setBusy]=useState(false);const {rows}=useReportOperations();
 const pending=rows.some(op=>op.entity===`report:${r.id}`&&op.status!=='sent');
 const submit=async(intent:'save'|'send')=>{
  if(busy||pending)return;if(intent==='send'&&!v.conclusions.trim()){toast('Заполните выводы перед отправкой','error');return;}
  setBusy(true);try{await queueReport({kind:'weekly',reportId:r.id,districtId:r.districtId,weekStart:r.weekStart,intent,fields:v,baseRevision:draft.baseRevision||null});toast('Текст сохранён на устройстве и поставлен в очередь');}catch(e){toast((e as Error).message,'error');}finally{setBusy(false);}
 };
 return <><DraftNotice draft={draft}/><ReportDeliveryStatus entity={`report:${r.id}`}/>
  <Field label="Выводы" required hint="Главное за неделю в 2–3 предложениях"><Textarea rows={4} value={v.conclusions} onChange={e=>draft.set({...v,conclusions:e.target.value})}/></Field>
  <Field label="Проблемы"><Textarea rows={3} value={v.problems} onChange={e=>draft.set({...v,problems:e.target.value})}/></Field>
  <Field label="План на следующую неделю"><Textarea rows={3} value={v.plan} onChange={e=>draft.set({...v,plan:e.target.value})}/></Field>
  <div className="row wrap no-print"><Button icon={Save} disabled={!draft.dirty||busy||pending} onClick={()=>void submit('save')}>Сохранить черновик</Button><Button variant="primary" icon={Send} disabled={busy||pending} onClick={()=>void submit('send')}>{busy?'Сохраняю…':pending?'Ждёт подтверждения':'Отправить'}</Button></div>
 </>;
}
