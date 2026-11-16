import { CheckCheck, RotateCcw, Repeat2, Wrench, ArrowUpRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { analyticsTasks } from '../data/insights';
import { qualityInsights, type ReworkEvent } from '../data/quality';
import { useAppState } from '../data/store';
import { pct } from '../data/calc';
import { fmtStamp } from '../lib/date';
import { openRecords, openTask } from '../ui/global';
import { useLookup, useMe, usePeriod } from '../ui/hooks';
import { Button, Empty, Modal } from '../ui/kit';
import { useScopeDistrict } from '../ui/widgets';

export default function QualityPage() {
  const state = useAppState(), me = useMe(), period = usePeriod(), district = useScopeDistrict(), L = useLookup();
  const tasks = useMemo(() => analyticsTasks(state, me, district), [state.tasks, me, district]);
  const q = useMemo(() => qualityInsights(tasks, period.from, period.to), [tasks, period.from, period.to]);
  const [details, setDetails] = useState<{title:string;events:ReworkEvent[]} | null>(null);
  const max = Math.max(1, ...q.reasons.map(r=>r.events.length));
  return <div className="quality-page col" style={{gap:20}}>
    <div className="quality-summary grid">
      <button className="card quality-number" onClick={()=>openRecords({title:'Приняты с первого раза',tasks:q.firstPass,rule:'Подтверждены в выбранном периоде; в истории задачи не зафиксировано возвратов.'})}>
        <span className="row"><CheckCheck size={19}/><b>Принято с первого раза</b><ArrowUpRight size={16}/></span>
        <strong>{q.firstPassShare===null?'—':pct(q.firstPassShare)}</strong><small>{q.firstPass.length} из {q.confirmed.length} подтверждённых задач</small>
      </button>
      <button className="card quality-number" onClick={()=>setDetails({title:'Возвраты на доработку',events:q.events})}>
        <span className="row"><RotateCcw size={19}/><b>Возвраты</b><ArrowUpRight size={16}/></span>
        <strong>{q.events.length}</strong><small>По {q.returned.length} задачам за выбранный период</small>
      </button>
      <button className="card quality-number" onClick={()=>setDetails({title:'Повторные возвраты',events:q.events.filter(e=>e.repeated)})}>
        <span className="row"><Repeat2 size={19}/><b>Повторная доработка</b><ArrowUpRight size={16}/></span>
        <strong>{q.repeated.length}</strong><small>Задачи со вторым или следующим возвратом в периоде</small>
      </button>
      <button className="card quality-number" onClick={()=>openRecords({title:'На исправлении сейчас',tasks:q.correcting,rule:'Текущий статус — «В работе», в истории есть возврат. Независимо от выбранного периода.'})}>
        <span className="row"><Wrench size={19}/><b>На исправлении сейчас</b><ArrowUpRight size={16}/></span>
        <strong>{q.correcting.length}</strong><small>Текущая очередь, независимо от периода</small>
      </button>
    </div>
    <div className="grid g-2">
      <section className="card card-pad">
        <h2>Причины доработки</h2><p className="small muted">Категории выбирает проверяющий при возврате результата.</p>
        {q.events.length ? <div className="col" style={{gap:14}}>{q.reasons.filter(r=>r.events.length).map(r=><button key={r.id} className="quality-reason" onClick={()=>setDetails({title:r.label,events:r.events})}>
          <span><b>{r.label}</b><strong>{r.events.length}</strong></span><i><span style={{width:`${r.events.length/max*100}%`}}/></i>
        </button>)}</div> : <Empty icon={CheckCheck} title="Возвратов за период нет" text="Новые возвраты появятся здесь после проверки результатов."/>}
        {q.unclassified>0&&<p className="small muted">У {q.unclassified} возвратов категория не указана. Исходные комментарии доступны в деталях.</p>}
      </section>
      <section className="card card-pad">
        <h2>Что можно улучшить</h2>
        {q.reasons.filter(r=>r.id!=='unspecified'&&r.events.length).slice(0,3).map(r=><div key={r.id} className="quality-suggestion"><b>{r.label}</b><p>{({requirements:'Уточните условия приёмки в описании задачи и добавьте проверяемый чек-лист.',evidence:'Укажите заранее, какие фотографии, ссылки или документы должны подтверждать результат.',accuracy:'Добавьте проверку чисел, дат и источников перед отправкой результата.',completeness:'Разбейте результат на обязательные части и назначьте ответственного за каждую.',format:'Приложите утверждённый шаблон или пример оформления.',other:'Откройте комментарии проверяющих и обсудите повторяющиеся затруднения.'} as Record<string,string>)[r.id]}</p></div>)}
        {!q.reasons.some(r=>r.id!=='unspecified'&&r.events.length)&&<p className="muted small">После появления категорий возвратов здесь будут рекомендации по инструкциям и проверке результата. Для старых комментариев причины автоматически не угадываются.</p>}
      </section>
    </div>
    <section className="card">
      <div className="card-head"><h2>По ответственным за задачи</h2></div>
      {q.people.length?<div className="table-wrap"><table className="tbl"><thead><tr><th>Ответственный</th><th className="right">Подтверждено</th><th className="right">С первого раза</th><th className="right">Возвратов</th><th className="right">Повторных задач</th></tr></thead><tbody>{q.people.map(p=><tr key={p.userId}>
        <th scope="row">{L.user(p.userId)?.name??'Ответственный не найден'}</th>
        <td className="right"><button className="quality-link" onClick={()=>openRecords({title:'Подтверждённые задачи',tasks:p.confirmed})}>{p.confirmed.length}</button></td>
        <td className="right"><button className="quality-link" onClick={()=>openRecords({title:'Без возвратов в истории',tasks:p.firstPass})}>{p.share===null?'—':pct(p.share)}</button></td>
        <td className="right"><button className="quality-link" onClick={()=>setDetails({title:'Возвраты по задачам сотрудника',events:p.events})}>{p.events.length}</button></td>
        <td className="right"><button className="quality-link" onClick={()=>setDetails({title:'Повторная доработка',events:p.events.filter(e=>e.repeated)})}>{p.repeated.length}</button></td>
      </tr>)}</tbody></table></div>:<div className="card-body"><Empty icon={CheckCheck} title="Пока недостаточно данных" text="Нужны подтверждённые результаты или возвраты за выбранный период."/></div>}
    </section>
    <p className="small muted">Принятие с первого раза считается по дате подтверждения, возвраты — по дате комментария проверяющего. Один результат может возвращаться несколько раз. Разбивка использует текущего ответственного задачи.{q.undated>0&&` У ${q.undated} задач дата возврата не определена, поэтому эти возвраты не включены в выбранный период.`}</p>
    <Modal open={!!details} onClose={()=>setDetails(null)} title={details?.title??''} width={760}>
      {details?.events.length ? <div className="col" style={{gap:14}}>{details.events.map(e=><article className="post-card" key={e.id}><div className="row"><b className="grow">{e.task.title}</b><Button size="sm" onClick={()=>{setDetails(null);openTask(e.task.id);}}>Открыть задачу</Button></div><p style={{whiteSpace:'pre-wrap'}}>{e.comment.text}</p><span className="small muted">{fmtStamp(e.comment.at)} · {L.user(e.comment.authorId)?.name??'Проверяющий не указан'}{e.repeated?' · повторный возврат':''}</span></article>)}</div>:<Empty icon={CheckCheck} title="Записей нет"/>}
    </Modal>
  </div>;
}
