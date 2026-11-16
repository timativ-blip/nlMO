import type { Comment, Task } from './types';
import { dateInMoscow } from './insights';
import { inRange } from '../lib/date';
import { isReworkReason, REWORK_REASONS } from './rework';
export interface ReworkEvent { id: string; task: Task; comment: Comment; day: string; repeated: boolean }
const uniqueTasks = (events: ReworkEvent[]) => [...new Map(events.map(e => [e.task.id, e.task])).values()];
/** Counts explicit returns, never infers a reason from prose or a missing result. */
export function qualityInsights(tasks: Task[], from: string, to: string) {
  const eligible = tasks.filter(t => t.status !== 'cancelled');
  const allEvents = eligible.flatMap(task => {
    const seen = new Set<string>();
    const returns = task.comments.filter(c => c.kind === 'return').filter((c, i) => {
      const key = c.id || `row-${i}`; if (seen.has(key)) return false; seen.add(key); return true;
    });
    if (!returns.length && task.returnedAt) returns.push({id:`legacy-${task.id}`,authorId:'',at:task.returnedAt,text:'Возврат зафиксирован в истории задачи',kind:'return'});
    return returns.map((comment, index) => ({ id:`${task.id}:${comment.id || index}`,task,comment,day:dateInMoscow(comment.at),index }))
      .filter(e => !!e.day).sort((a,b)=>a.day!.localeCompare(b.day!) || a.index-b.index)
      .map((e,index) => ({id:e.id,task,comment:e.comment,day:e.day!,repeated:index>0}));
  });
  const events = allEvents.filter(e => inRange(e.day,from,to)).sort((a,b)=>b.comment.at.localeCompare(a.comment.at));
  const confirmed = eligible.filter(t => t.status==='done' && inRange(dateInMoscow(t.confirmedAt),from,to));
  const hadReturn = (task:Task) => !!task.returnedAt || task.comments.some(c=>c.kind==='return');
  const firstPass = confirmed.filter(t=>!hadReturn(t));
  const returned = uniqueTasks(events), repeated = uniqueTasks(events.filter(e=>e.repeated));
  const correcting = eligible.filter(t=>t.status==='in_progress' && hadReturn(t));
  const reasons = [...Object.entries(REWORK_REASONS).map(([id,label])=>({id,label})),{id:'unspecified',label:'Категория не указана'}]
    .map(reason=>({...reason,events:events.filter(e=>(isReworkReason(e.comment.reworkReason)?e.comment.reworkReason:'unspecified')===reason.id)}))
    .sort((a,b)=>b.events.length-a.events.length);
  const ownerIds = [...new Set([...confirmed,...returned].map(t=>t.assigneeId))];
  const people = ownerIds.map(userId=>{
    const completed=confirmed.filter(t=>t.assigneeId===userId),good=firstPass.filter(t=>t.assigneeId===userId),back=events.filter(e=>e.task.assigneeId===userId);
    return {userId,confirmed:completed,firstPass:good,events:back,returned:uniqueTasks(back),repeated:uniqueTasks(back.filter(e=>e.repeated)),share:completed.length?good.length/completed.length:null};
  }).sort((a,b)=>b.events.length-a.events.length || b.confirmed.length-a.confirmed.length);
  return {events,confirmed,firstPass,firstPassShare:confirmed.length?firstPass.length/confirmed.length:null,returned,repeated,correcting,reasons,people,
    unclassified:events.filter(e=>!isReworkReason(e.comment.reworkReason)).length,
    undated:eligible.filter(t=>hadReturn(t)&&!allEvents.some(e=>e.task.id===t.id)).length};
}
