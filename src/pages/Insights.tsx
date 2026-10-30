import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCheck, Clock3, Hourglass, RotateCcw, Target, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { kpis, num, pct, rateDistricts } from '../data/calc';
import { analyticsTasks, periodTrend, processInsights, STATUS_COLORS, taskSnapshot } from '../data/insights';
import { useAppState } from '../data/store';
import { STATUS_LABEL, type Task } from '../data/types';
import { fmtDayMonth, fmtRange } from '../lib/date';
import { go } from '../lib/router';
import { openRecords } from '../ui/global';
import { useMe, usePeriod } from '../ui/hooks';
import { ActivityHeatmap, AnimatedNumber, DayColumns, DonutChart, ProgressRing, Sparkline, TimelineChart } from '../ui/charts';
import { Avatar, Button } from '../ui/kit';
import { HBars, useScopeDistrict } from '../ui/widgets';

function useInsightData() {
  const state = useAppState(), me = useMe(), period = usePeriod(), district = useScopeDistrict();
  const tasks = useMemo(() => analyticsTasks(state, me, district), [state.tasks, me, district]);
  const scoped = useMemo(() => ({ ...state, tasks }), [state, tasks]);
  const insights = useMemo(() => processInsights(tasks, state.users, period.from, period.to), [tasks, state.users, period.from, period.to]);
  return { state: scoped, me, period, district, tasks, insights };
}

export function StatCard({ label, value, unit, foot, icon: Icon, warning, onClick, trend }: { label: string; value: number | null; unit?: string; foot: string; icon: LucideIcon; warning?: boolean; onClick: () => void; trend?: number[] }) {
  return <button type="button" className={`stat-card ${warning ? 'stat-warning' : ''}`} onClick={onClick}>
    <span className="stat-top"><span className="stat-icon"><Icon size={18} /></span><ArrowUpRight size={16} className="stat-arrow" /></span>
    <span className="stat-label">{label}</span>
    <span className="stat-value">{value === null ? '—' : <AnimatedNumber value={value} precision={Number.isInteger(value) ? 0 : 1} />}<small>{unit}</small></span>
    <span className="stat-bottom"><span>{foot}</span>{trend && <Sparkline values={trend} />}</span>
  </button>;
}

const showTasks = (title: string, tasks: Task[], rule?: string) => openRecords({ title, tasks, rule });

export function InsightsOverview() {
  const { state: s, me, period, district, tasks } = useInsightData();
  const k = useMemo(() => kpis(s, period.from, period.to, district), [s, period.from, period.to, district]);
  const prev = useMemo(() => kpis(s, period.prevFrom, period.prevTo, district), [s, period.prevFrom, period.prevTo, district]);
  const trend = useMemo(() => periodTrend(tasks, period.from, period.to), [tasks, period.from, period.to]);
  const distribution = useMemo(() => taskSnapshot(tasks, period.from, period.to), [tasks, period.from, period.to]);
  const districts = useMemo(() => rateDistricts(s, period.from, period.to).filter((d) => !district || d.districtId === district), [s, period.from, period.to, district]);
  const delta = k.confirmed.length - prev.confirmed.length;
  const personal = me.role === 'member';
  const cohortTotal = distribution.reduce((n,d) => n+d.tasks.length,0);
  const completion = cohortTotal ? (distribution.find((d) => d.id === 'done')?.tasks.length ?? 0)/cohortTotal : 0;
  return <div className="insights-overview">
    <div className="overview-summary">
      <section className="metric-headline card">
        <div className="metric-copy"><span className="eyebrow"><span className="live-dot" />{personal ? 'Мои результаты' : 'Результаты команды'}</span>
          <h2>{personal ? 'Выполнение задач' : 'Выполнение плана'}</h2>
          <div className="headline-number"><AnimatedNumber value={(personal ? completion : k.plan)*100} suffix="%" /><span className="metric-period">{period.label.toLowerCase()}</span></div>
          <p>{personal ? 'Доля выполненных задач со сроком в выбранном периоде.' : 'Подтверждённые результаты по показателям с учётом планов округов.'}</p>
          <div className={`metric-delta ${delta >= 0 ? 'positive' : 'negative'}`}>{delta >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{delta >= 0 ? '+' : ''}{delta} подтверждённых к прошлому периоду</div>
        </div><ProgressRing value={personal ? completion : k.plan} label={personal ? 'выполнено' : 'плана'} />
      </section>
      <StatCard label="Подтверждено" value={k.confirmed.length} icon={CheckCheck} foot={`Было ${prev.confirmed.length} в прошлом периоде`} onClick={() => showTasks('Подтверждённые результаты', k.confirmed, 'По дате подтверждения в выбранном периоде.')} trend={trend.map((d)=>d.confirmed)} />
      <StatCard label="Вовремя" value={k.onTimeShare === null ? null : Math.round(k.onTimeShare*100)} unit="%" icon={Clock3} foot={k.onTimeShare === null ? 'Пока нет подтверждённых результатов' : `${k.onTimeRecords.length} из ${k.confirmed.length} результатов`} onClick={() => showTasks('Результаты, сданные вовремя', k.onTimeRecords, 'Дата сдачи результата не позже срока задачи.')} />
    </div>
    <div className="analysis-grid">
      <section className="card analysis-wide"><div className="card-head"><div><span className="eyebrow">Темп работы</span><h2>От задач к результатам</h2></div><span className="chart-caption">{fmtRange(period.from, period.to)}</span></div>
        <div className="card-body"><TimelineChart data={trend} onPick={(p)=>showTasks(`Результаты: ${fmtRange(p.from,p.to)}`, p.tasks)} /></div>
      </section>
      <section className="card"><div className="card-head"><div><span className="eyebrow">Состояние задач</span><h2>Как движется работа</h2></div></div>
        <div className="card-body"><DonutChart segments={distribution.map((d)=>({ id:d.id,label:STATUS_LABEL[d.id],value:d.tasks.length,color:STATUS_COLORS[d.id],onClick:()=>showTasks(STATUS_LABEL[d.id],d.tasks) }))} /><p className="chart-note">Задачи со сроком в выбранном периоде. Отменённые исключены.</p></div>
      </section>
      <section className="card analysis-wide"><div className="card-head"><div><span className="eyebrow">Показатели</span><h2>Факт и план</h2></div><Button variant="ghost" size="sm" onClick={()=>go('/analytics/metrics')}>Правила <ArrowUpRight size={14} /></Button></div>
        <div className="metric-grid card-body">{k.facts.map((f)=><button key={f.metric.id} type="button" className="metric-tile" onClick={()=>openRecords({title:f.metric.name,tasks:f.records,rule:`Сумма значений из подтверждённых задач. План пропорционален дням периода.`,cellValue:(t)=>String(t.result?.value??0)})}>
          <span className="stat-label">{f.metric.name}</span><b>{num(f.fact)}<small> / {num(f.plan)}</small></b><span className="metric-track"><i style={{width:`${Math.max(0,Math.min(1,f.pct))*100}%`}} /></span><span className="small muted">{pct(f.pct)} · {f.metric.unit}</span>
        </button>)}</div>
      </section>
      <section className="card action-card"><span className="stat-icon warning"><TriangleAlert size={20} /></span><h2>{k.overdue.length ? 'Просрочки требуют внимания' : 'Просроченных задач нет'}</h2><p>Сейчас просрочено <b>{k.overdue.length}</b> задач. На проверке — <b>{k.review.length}</b>.</p><Button onClick={()=>go('/analytics/processes')} icon={ArrowRight}>Разобрать процессы</Button><span className="chart-note">Текущая ситуация, независимо от периода выше.</span></section>
    </div>
    {!personal && <section className="card" style={{marginTop:20}}><div className="card-head"><div><span className="eyebrow">Территории</span><h2>Выполнение плана по округам</h2></div><span className="chart-caption">Отметка на шкале — 100%</span></div><div className="card-body district-comparison"><HBars rows={districts.map((d)=>({id:d.districtId,label:d.name,value:d.assigned.length ? d.plan:null,text:d.assigned.length ? pct(d.plan):'—',onClick:()=>go(`/team/districts/${d.districtId}`)}))} /></div></section>}
  </div>;
}

export function ProcessAnalytics() {
  const { insights: a, period } = useInsightData();
  const pending = a.waiting.filter((r)=>r.days>=3);
  const dueCount = a.upcoming.reduce((n,d)=>n+d.tasks.length,0);
  const largest = a.upcoming.reduce((best,d)=>d.tasks.length>best.tasks.length ? d:best,a.upcoming[0]);
  return <div className="process-analytics">
    <div className="analysis-intro"><div><span className="eyebrow">Процессы и узкие места</span><h2>Что поможет двигаться быстрее</h2><p>Сроки и очередь проверки — на сегодня. Скорость и доработки — за {period.label.toLowerCase()}.</p></div><span className="subtle-tag"><span className="live-dot" />По данным задач</span></div>
    <div className="stat-grid">
      <StatCard label="До подтверждения" value={a.cycleMedian} unit="дн." icon={Hourglass} foot={`Медиана · ${a.cycles.length} задач с датами`} onClick={()=>showTasks('От создания до подтверждения',a.cycles.map((r)=>r.task),'Календарные дни по Москве. Медиана по задачам, подтверждённым в выбранном периоде.')} />
      <StatCard label="Ожидают проверки" value={a.review.length} icon={CheckCheck} foot={`${pending.length} ждут 3 дня и дольше`} warning={!!pending.length} onClick={()=>showTasks('Очередь на проверку',a.review,'Текущие задачи в статусе «На проверке».')} />
      <StatCard label="С доработкой" value={a.returnShare===null ? null:Math.round(a.returnShare*100)} unit="%" icon={RotateCcw} foot={`${a.returned.length} из ${a.confirmed.length} подтверждённых`} onClick={()=>showTasks('Подтверждённые задачи с доработкой',a.returned,'Хотя бы один возврат на доработку в истории задачи. Среди подтверждённых в выбранном периоде.')} />
      <StatCard label="Сроки в ближайшие 7 дней" value={dueCount} icon={Target} foot="Новые и в работе · начиная с сегодня" onClick={()=>showTasks('Сроки на ближайшие 7 дней',a.upcoming.flatMap((d)=>d.tasks))} />
    </div>
    <div className="analysis-grid">
      <section className="card"><div className="card-head"><div><span className="eyebrow">Риск срыва</span><h2>Возраст просрочек</h2></div><span className="number-badge">{a.overdue.length}</span></div><div className="card-body"><div className="aging-bars">{a.aging.map((b,i)=><button type="button" key={b.id} onClick={()=>showTasks(`Просрочено на ${b.label}`,b.tasks)} className="aging-row"><span>{b.label}</span><span className="aging-track"><i className={`age-${i}`} style={{width:`${b.tasks.length/Math.max(1,a.overdue.length)*100}%`}} /></span><b>{b.tasks.length}</b><ArrowUpRight size={14} /></button>)}</div><p className="chart-note">Только «Новая» и «В работе». Сданные на проверку не считаются просроченными.</p></div></section>
      <section className="card analysis-wide"><div className="card-head"><div><span className="eyebrow">Планирование</span><h2>Нагрузка на ближайшие дни</h2></div><span className="chart-caption">Текущие сроки</span></div><div className="card-body"><DayColumns days={a.upcoming.map((d)=>({...d,count:d.tasks.length}))} onPick={(d)=>showTasks(`Срок ${fmtDayMonth(d.day)}`,d.tasks)} /><p className="chart-note">{largest.tasks.length ? `Больше всего задач — ${fmtDayMonth(largest.day)}: ${largest.tasks.length}. Нажмите на столбец, чтобы открыть список.`:'На ближайшие 7 дней открытых задач нет.'}</p></div></section>
      <section className="card analysis-wide"><div className="card-head"><div><span className="eyebrow">Ритм работы</span><h2>Календарь результатов</h2></div></div><div className="card-body"><ActivityHeatmap days={a.heat.map((d)=>({...d,count:d.tasks.length}))} onPick={(d)=>showTasks(`Подтверждено ${fmtDayMonth(d.day)}`,d.tasks)} /><p className="chart-note">Каждая ячейка — подтверждённые результаты за день, по московскому времени.</p></div></section>
      <section className="card"><div className="card-head"><div><span className="eyebrow">Очередь проверки</span><h2>Кто ждёт дольше</h2></div></div><div className="review-queue">{!a.waiting.length ? <div className="chart-empty">В очереди нет задач с известной датой сдачи.</div>:a.waiting.slice(0,5).map(({task,days})=><button type="button" key={task.id} onClick={()=>showTasks(task.title,[task])}><span className={`queue-days ${days>=3 ? 'late':''}`}>{days}<small>дн.</small></span><span className="grow"><b>{task.title}</b><small>{task.result?.submittedDate ? `Сдано ${fmtDayMonth(task.result.submittedDate)}`:'Дата сдачи результата'}</small></span><ArrowUpRight size={15} /></button>)}</div><div className="card-footer">Медиана ожидания: {a.reviewMedian===null ? 'нет данных':`${num(a.reviewMedian)} дн.`}{a.waiting.length<a.review.length && ` · без даты сдачи: ${a.review.length-a.waiting.length}`}</div></section>
    </div>
    <section className="card" style={{marginTop:20}}><div className="card-head"><div><span className="eyebrow">Распределение работы</span><h2>Текущая нагрузка команды</h2></div><span className="chart-caption">По числу открытых задач</span></div><div className="workload-list">{!a.workloads.length ? <div className="chart-empty">Открытых назначений пока нет.</div>:a.workloads.slice(0,10).map((r)=><button type="button" key={r.user.id} className="workload-row" onClick={()=>showTasks(`Открытые задачи: ${r.user.name}`,r.active)}><Avatar user={r.user} size={32} /><span className="workload-person"><b>{r.user.name}</b><small>{r.overdue.length ? `${r.overdue.length} просрочено`:'Без просрочек'}</small></span><span className="workload-track"><i style={{width:`${(r.active.length-r.review.length-r.overdue.length)/Math.max(1,a.workloads[0].active.length)*100}%`}} /><i className="review" style={{width:`${r.review.length/Math.max(1,a.workloads[0].active.length)*100}%`}} /><i className="overdue" style={{width:`${r.overdue.length/Math.max(1,a.workloads[0].active.length)*100}%`}} /></span><b>{r.active.length}</b><ArrowUpRight size={15} /></button>)}</div><div className="card-footer workload-legend"><span><i />В работе / новые</span><span><i className="review" />На проверке</span><span><i className="overdue" />Просрочено</span><span>Первые 10 по нагрузке. Соисполнение учитывается у каждого участника.</span></div></section>
  </div>;
}
