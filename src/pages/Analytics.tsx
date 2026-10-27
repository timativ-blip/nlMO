import { ChevronDown, ChevronRight, Info, Settings2, Target } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { ACTIVE, isOverdue, kpis, num, pct, rateDistricts, rateUsers, weeklyTrend, type DistrictScore, type PersonScore } from '../data/calc';
import * as P from '../data/perm';
import { updateMetric, updateWeights, useAppState } from '../data/store';
import type { Priority, Weights } from '../data/types';
import { PRIORITY_LABEL } from '../data/types';
import { fmtDayMonth, fmtRange } from '../lib/date';
import { go, type Route } from '../lib/router';
import { openRecords } from '../ui/global';
import { useLookup, useMe, usePeriod } from '../ui/hooks';
import { Avatar, Bar, Button, Field, Input, Modal, run, Segmented, Tabs, toast } from '../ui/kit';
import { ContextBar, HBars, TrendChart, useScopeDistrict } from '../ui/widgets';
import { compute, useJson, type PdData } from './Media';

type Tab = 'overview' | 'okrugs' | 'rating' | 'load' | 'metrics';

export default function AnalyticsPage({ route }: { route: Route }) {
  const tab = (route.parts[1] as Tab) || 'overview';
  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Аналитика</h1><div className="sub">Каждая цифра открывает список записей, из которых она рассчитана</div></div>
        <ContextBar showDistrict={tab !== 'rating' && tab !== 'okrugs'} />
      </div>
      <Tabs value={tab} onChange={(v) => go(`/analytics/${v}`)} tabs={[{ value: 'overview', label: 'Обзор' }, { value: 'okrugs', label: 'Сводка по округам' }, { value: 'rating', label: 'Рейтинг' }, { value: 'load', label: 'Нагрузка' }, { value: 'metrics', label: 'Показатели и правила' }]} />
      {tab === 'overview' && <Overview />}
      {tab === 'okrugs' && <OkrugSummary />}
      {tab === 'rating' && <Rating />}
      {tab === 'load' && <Load />}
      {tab === 'metrics' && <Metrics />}
    </>
  );
}

function Overview() {
  const s = useAppState();
  const period = usePeriod();
  const districtId = useScopeDistrict();
  const k = useMemo(() => kpis(s, period.from, period.to, districtId), [s, period, districtId]);
  const trend = useMemo(() => weeklyTrend(s, 12, districtId), [s, districtId]);
  const dist = useMemo(() => rateDistricts(s, period.from, period.to), [s, period]);
  const Kpi = ({ label, value, unit, rule, src, onClick }: { label: string; value: string; unit: string; rule: string; src: string; onClick: () => void }) => (
    <button className="kpi" onClick={onClick}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}<small>{unit}</small></span>
      <span className="kpi-foot" title={rule}><Info size={12} />{src}</span>
    </button>
  );
  return (
    <>
      <div className="grid g-4">
        <Kpi label="Выполнение плана" value={pct(k.plan)} unit="" src="показатели из задач" rule="Взвешенное среднее факт/план по показателям" onClick={() => go('/analytics/metrics')} />
        <Kpi label="Подтверждённые результаты" value={String(k.confirmed.length)} unit="задач" src="статус «Выполнена»" rule="" onClick={() => openRecords({ title: 'Подтверждённые результаты', rule: 'Задачи, подтверждённые в выбранном периоде (по дате подтверждения).', tasks: k.confirmed })} />
        <Kpi label="Доля выполненных вовремя" value={k.onTimeShare === null ? '—' : pct(k.onTimeShare)} unit="" src="дата сдачи ≤ срока" rule="" onClick={() => openRecords({ title: 'Сдано вовремя', rule: 'Подтверждённые задачи, результат по которым сдан не позже срока. Доля = эти задачи / все подтверждённые.', tasks: k.onTimeRecords })} />
        <Kpi label="Просрочки" value={String(k.overdue.length)} unit="задач" src="на текущую дату" rule="" onClick={() => openRecords({ title: 'Просроченные задачи', rule: 'Статус «Новая» или «В работе» и срок раньше сегодняшнего дня (МСК).', tasks: k.overdue })} />
      </div>
      <div className="grid g-main" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><h2 className="grow">Динамика за 12 недель</h2></div>
          <div className="card-body"><TrendChart data={trend} onPick={(p) => openRecords({ title: `Подтверждено: ${fmtRange(p.from, p.to)}`, tasks: kpis(s, p.from, p.to, districtId).confirmed })} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h2 className="grow">Сравнение округов</h2><span className="small muted">выполнение плана</span></div>
          <div className="card-body">
            <HBars rows={dist.map((d) => ({ id: d.districtId, label: d.name, value: d.assigned.length ? d.plan : null, text: d.assigned.length ? pct(d.plan) : '—', onClick: () => go(`/team/districts/${d.districtId}`) }))} />
            <div className="small muted" style={{ marginTop: 8 }}>Вертикальная отметка — 100 % плана. Период: {period.label.toLowerCase()}.</div>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h2>Показатели</h2></div>
        <div className="card-body grid g-4" style={{ gap: 12 }}>
          {k.facts.map((f) => (
            <button key={f.metric.id} className="kpi" style={{ background: 'var(--surface-2)' }} onClick={() => openRecords({ title: f.metric.name, rule: `Сумма значений «${f.metric.unit}» из подтверждённых задач, связанных с показателем. План — ${f.metric.monthlyPlan} в месяц на округ, пропорционально периоду.`, tasks: f.records, cellValue: (t) => String(t.result?.value ?? 0) })}>
              <span className="kpi-label">{f.metric.name}</span>
              <span className="kpi-value">{num(f.fact)}<small>/ {f.plan} {f.metric.unit}</small></span>
              <Bar value={f.pct} />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Rating() {
  const s = useAppState();
  const me = useMe();
  const period = usePeriod();
  const [mode, setMode] = useState<'people' | 'districts'>('people');
  const [group, setGroup] = useState<'member' | 'coordinator'>('member');
  const [open, setOpen] = useState<string | null>(null);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const w = s.weights;
  const people = useMemo(() => rateUsers(s, s.users.filter((u) => u.active && u.role === group), period.from, period.to), [s, group, period]);
  const districts = useMemo(() => rateDistricts(s, period.from, period.to), [s, period]);
  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <div className="grow" style={{ minWidth: 260 }}>
            <h2 style={{ marginBottom: 6 }}>Как считается рейтинг</h2>
            {mode === 'people' ? (
              <p className="muted" style={{ margin: 0 }}>Оценка 0–100 = <b>{w.personCompletion}%</b> × выполнение (подтверждённые / назначенные на период) + <b>{w.personOnTime}%</b> × доля сданных вовремя + <b>{w.personVolume}%</b> × объём (баллы результатов относительно лидера). Баллы задачи = вес приоритета, за опоздание × {w.lateFactor}. Учитываются только назначенные и подтверждённые задачи — количество созданных задач на оценку не влияет. Меньше {w.minTasks} задач в периоде — «Недостаточно данных».</p>
            ) : (
              <p className="muted" style={{ margin: 0 }}>Оценка 0–100 = <b>{w.districtPlan}%</b> × выполнение плана по показателям (не выше 100 %) + <b>{w.districtCompletion}%</b> × доля выполненных задач + <b>{w.districtOnTime}%</b> × доля сданных вовремя. Меньше {w.minTasks} задач в периоде — «Недостаточно данных».</p>
            )}
          </div>
          {P.canEditWeights(me) && <Button icon={Settings2} onClick={() => setWeightsOpen(true)}>Настроить веса</Button>}
        </div>
      </div>
      <div className="toolbar">
        <Segmented label="Рейтинг" value={mode} onChange={(v) => { setMode(v); setOpen(null); }} options={[{ value: 'people', label: 'Сотрудники' }, { value: 'districts', label: 'Округа' }]} />
        {mode === 'people' && <Segmented label="Группа" value={group} onChange={setGroup} options={[{ value: 'member', label: 'Участники' }, { value: 'coordinator', label: 'Координаторы' }]} />}
        <span className="small muted">Сравниваются люди одной роли за один и тот же период.</span>
      </div>
      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr><th style={{ width: 50 }}>#</th><th>{mode === 'people' ? 'Сотрудник' : 'Округ'}</th><th className="right">Оценка</th>{mode === 'districts' && <th className="right hide-sm">План</th>}<th className="right hide-sm">Выполнение</th><th className="right hide-sm">Вовремя</th>{mode === 'people' && <th className="right hide-sm">Баллы</th>}<th /></tr></thead>
          <tbody>
            {(mode === 'people' ? people : districts).map((r, i) => {
              const id = 'user' in r ? r.user.id : r.districtId;
              const isOpen = open === id;
              return (
                <Fragment key={id}>
                  <tr className="clickable" onClick={() => setOpen(isOpen ? null : id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(isOpen ? null : id)} aria-expanded={isOpen}>
                    <td><span className={`rank ${r.score !== null && i < 3 ? `r${i + 1}` : ''}`}>{r.score === null ? '–' : i + 1}</span></td>
                    <td>{'user' in r ? <span className="row"><Avatar user={r.user} size={28} /><span className="col" style={{ gap: 0 }}><b>{r.user.name}</b><span className="small muted">{s.districts.find((d) => d.id === r.user.districtId)?.name}</span></span></span> : <b>{r.name}</b>}</td>
                    <td className="right">{r.score === null ? <span className="small muted">Недостаточно данных</span> : <span className="score">{Math.round(r.score)}</span>}</td>
                    {'plan' in r && <td className="right hide-sm">{pct(r.plan)}</td>}
                    <td className="right hide-sm">{pct(r.completion)}</td>
                    <td className="right hide-sm">{r.done.length ? pct(r.onTime) : '—'}</td>
                    {'points' in r && <td className="right hide-sm">{num(r.points)}</td>}
                    <td className="right">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                  </tr>
                  {isOpen && <tr><td colSpan={8} style={{ background: 'var(--surface-2)', padding: 16 }}>{'user' in r ? <PersonBreakdown r={r as PersonScore} /> : <DistrictBreakdown r={r as DistrictScore} />}</td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {weightsOpen && <WeightsModal onClose={() => setWeightsOpen(false)} />}
    </>
  );
}

function PersonBreakdown({ r }: { r: PersonScore }) {
  const s = useAppState();
  const w = s.weights;
  const wsum = w.personCompletion + w.personOnTime + w.personVolume;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="formula">{r.score === null
        ? `Назначено задач со сроком в периоде: ${r.assigned.length} (нужно минимум ${w.minTasks}) → Недостаточно данных`
        : `(${w.personCompletion} × ${pct(r.completion)} выполнение  [${r.done.length} из ${r.assigned.length}]\n + ${w.personOnTime} × ${pct(r.onTime)} вовремя\n + ${w.personVolume} × ${pct(r.volume)} объём  [${num(r.points)} балла]) / ${wsum} = ${Math.round(r.score)}`}</div>
      <div className="row wrap">
        <Button size="sm" onClick={() => openRecords({ title: `Назначено на период: ${r.user.name}`, tasks: r.assigned })}>Назначенные задачи · {r.assigned.length}</Button>
        <Button size="sm" onClick={() => openRecords({ title: `Вклад в рейтинг: ${r.user.name}`, rule: 'Баллы = вес приоритета; если результат сдан после срока — умножается на коэффициент опоздания.', tasks: r.done, cellValue: (t) => r.contributions.find((c) => c.task.id === t.id)!.points.toFixed(1) })}>Вклад результатов · {r.done.length}</Button>
      </div>
      {r.contributions.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          {r.contributions.slice(0, 6).map((c) => <div key={c.task.id} className="row small"><span className="grow ellipsis">{c.task.title}</span><span className="muted">{PRIORITY_LABEL[c.task.priority]}{c.onTime ? '' : ', с опозданием'}</span><b>+{c.points.toFixed(1)}</b></div>)}
        </div>
      )}
    </div>
  );
}
function DistrictBreakdown({ r }: { r: DistrictScore }) {
  const s = useAppState();
  const w = s.weights;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="formula">{r.score === null ? `Задач в периоде: ${r.assigned.length} (нужно минимум ${w.minTasks}) → Недостаточно данных` : `(${w.districtPlan} × ${pct(Math.min(r.plan, 1))} план + ${w.districtCompletion} × ${pct(r.completion)} выполнение + ${w.districtOnTime} × ${pct(r.onTime)} вовремя) / ${w.districtPlan + w.districtCompletion + w.districtOnTime} = ${Math.round(r.score)}`}</div>
      <div className="grid g-2" style={{ gap: 8 }}>
        {r.facts.map((f) => <button key={f.metric.id} className="hbar-row" style={{ gridTemplateColumns: '160px 1fr 80px' }} onClick={() => openRecords({ title: `${f.metric.name}: ${r.name}`, tasks: f.records, cellValue: (t) => String(t.result?.value ?? 0) })}><span className="ellipsis small">{f.metric.name} ×{f.metric.weight}</span><Bar value={f.pct} /><span className="right small">{num(f.fact)} / {f.plan}</span></button>)}
      </div>
      <div className="row wrap"><Button size="sm" onClick={() => openRecords({ title: `Задачи периода: ${r.name}`, tasks: r.assigned })}>Все задачи периода · {r.assigned.length}</Button><Button size="sm" onClick={() => go(`/team/districts/${r.districtId}`)}>Страница округа</Button></div>
    </div>
  );
}

function WeightsModal({ onClose }: { onClose: () => void }) {
  const s = useAppState();
  const [w, setW] = useState<Weights>(structuredClone(s.weights));
  const [metrics, setMetrics] = useState(s.metrics.map((m) => ({ id: m.id, name: m.name, unit: m.unit, monthlyPlan: m.monthlyPlan, weight: m.weight })));
  const n = (v: string) => Math.max(0, +v || 0);
  const NumField = ({ label, k, step = 1 }: { label: string; k: keyof Omit<Weights, 'priority'>; step?: number }) => <Field label={label}><Input type="number" min={0} step={step} value={w[k] as number} onChange={(e) => setW({ ...w, [k]: n(e.target.value) })} /></Field>;
  const save = () => {
    if (w.personCompletion + w.personOnTime + w.personVolume === 0 || w.districtPlan + w.districtCompletion + w.districtOnTime === 0) return toast('Сумма весов в группе не может быть нулевой — задайте хотя бы один вес больше 0.', 'error');
    if (run(() => { updateWeights(w); metrics.forEach((m) => updateMetric(m.id, { monthlyPlan: m.monthlyPlan, weight: m.weight })); }, 'Веса сохранены — рейтинг пересчитан')) onClose();
  };
  return (
    <Modal open onClose={onClose} title="Настройка весов рейтинга" width={720} footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить и пересчитать</Button></>}>
      <div className="col" style={{ gap: 18 }}>
        <div><h3 style={{ marginBottom: 8 }}>Сотрудники</h3><div className="grid g-3" style={{ gap: 10 }}><NumField label="Выполнение, %" k="personCompletion" /><NumField label="Вовремя, %" k="personOnTime" /><NumField label="Объём, %" k="personVolume" /></div></div>
        <div><h3 style={{ marginBottom: 8 }}>Округа</h3><div className="grid g-3" style={{ gap: 10 }}><NumField label="План, %" k="districtPlan" /><NumField label="Выполнение, %" k="districtCompletion" /><NumField label="Вовремя, %" k="districtOnTime" /></div></div>
        <div><h3 style={{ marginBottom: 8 }}>Вес задач по приоритету</h3><div className="grid g-4" style={{ gap: 10 }}>{(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <Field key={p} label={PRIORITY_LABEL[p]}><Input type="number" min={0} step={0.1} value={w.priority[p]} onChange={(e) => setW({ ...w, priority: { ...w.priority, [p]: n(e.target.value) } })} /></Field>)}</div></div>
        <div className="grid g-2" style={{ gap: 10 }}><NumField label="Коэффициент за опоздание" k="lateFactor" step={0.05} /><NumField label="Минимум задач для оценки" k="minTasks" /></div>
        <div><h3 style={{ marginBottom: 8 }}>Показатели: план и вес</h3>
          {metrics.map((m, i) => (
            <div key={m.id} className="grid g-3" style={{ gap: 10, alignItems: 'end', marginBottom: 8 }}>
              <div className="ellipsis" style={{ paddingBottom: 10 }}><b>{m.name}</b></div>
              <Field label={`План в месяц на округ, ${m.unit}`}><Input type="number" min={1} value={m.monthlyPlan} onChange={(e) => setMetrics(metrics.map((x, j) => (j === i ? { ...x, monthlyPlan: Math.max(1, n(e.target.value)) } : x)))} /></Field>
              <Field label="Вес в плане"><Input type="number" min={0} step={0.5} value={m.weight} onChange={(e) => setMetrics(metrics.map((x, j) => (j === i ? { ...x, weight: n(e.target.value) } : x)))} /></Field>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Load() {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const districtId = useScopeDistrict();
  const rows = s.users.filter((u) => u.active && (u.role === 'member' || u.role === 'coordinator') && (!districtId || u.districtId === districtId)).map((u) => {
    const t = s.tasks.filter((x) => (x.assigneeId === u.id || x.coAssigneeIds.includes(u.id)) && ACTIVE(x));
    return { u, t, n: t.filter((x) => x.status === 'new').length, w: t.filter((x) => x.status === 'in_progress').length, r: t.filter((x) => x.status === 'review').length, o: t.filter((x) => isOverdue(x)).length };
  }).sort((a, b) => b.t.length - a.t.length);
  const max = Math.max(1, ...rows.map((r) => r.t.length));
  const avg = rows.reduce((a, r) => a + r.t.length, 0) / Math.max(1, rows.length);
  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">Нагрузка на участников</h2><div className="legend"><span><i style={{ background: '#8a99ad' }} />Новые</span><span><i style={{ background: '#1d5fd1' }} />В работе</span><span><i style={{ background: '#e3a23b' }} />На проверке</span></div></div>
      <div className="card-body">
        <p className="small muted" style={{ marginTop: 0 }}>Активные задачи, где человек — ответственный или соисполнитель. В среднем {num(avg)} на человека; выделены те, у кого больше чем в 1,5 раза выше среднего.</p>
        {rows.map((r) => (
          <button key={r.u.id} className="hbar-row" style={{ gridTemplateColumns: 'minmax(140px, 220px) 1fr 110px' }} onClick={() => openRecords({ title: `Активные задачи: ${r.u.name}`, tasks: r.t })} disabled={!P.isManager(me) && me.role !== 'coordinator' && r.u.id !== me.id}>
            <span className="row"><Avatar user={r.u} size={24} /><span className="ellipsis">{r.u.name}<span className="small muted"> · {L.dname(r.u.districtId)}</span></span></span>
            <span className="stack" style={{ width: `${(r.t.length / max) * 100}%`, minWidth: 6 }}>
              <i style={{ width: `${(r.n / Math.max(1, r.t.length)) * 100}%`, background: '#8a99ad' }} />
              <i style={{ width: `${(r.w / Math.max(1, r.t.length)) * 100}%`, background: '#1d5fd1' }} />
              <i style={{ width: `${(r.r / Math.max(1, r.t.length)) * 100}%`, background: '#e3a23b' }} />
            </span>
            <span className="right small"><b style={{ color: r.t.length > avg * 1.5 ? 'var(--c-danger)' : undefined }}>{r.t.length}</b>{r.o > 0 && <span className="overdue-text"> · {r.o} просроч.</span>}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Metrics() {
  const s = useAppState();
  const period = usePeriod();
  const defs = [
    { name: 'Выполнение плана', unit: '%', period: 'выбранный', source: 'Подтверждённые задачи с показателем', rule: 'Для каждого показателя: факт / план (план = месячный × дней периода / 30 × число округов). Итог — среднее, взвешенное весами показателей, каждый показатель учитывается не выше 120 %.' },
    { name: 'Подтверждённые результаты', unit: 'задач', period: 'выбранный', source: 'Задачи со статусом «Выполнена»', rule: 'Количество задач, выполнение которых подтверждено в периоде (по дате подтверждения).' },
    { name: 'Доля выполненных вовремя', unit: '%', period: 'выбранный', source: 'Подтверждённые задачи', rule: 'Задачи, результат по которым сдан не позже срока / все подтверждённые. Нет подтверждённых — «Недостаточно данных».' },
    { name: 'Просрочки', unit: 'задач', period: 'на текущую дату', source: 'Активные задачи', rule: 'Статус «Новая» или «В работе», срок раньше сегодняшнего дня по Москве. Определяется автоматически.' },
    { name: 'Нагрузка', unit: 'задач на человека', period: 'на текущую дату', source: 'Активные задачи', rule: 'Задачи в статусах «Новая», «В работе», «На проверке», где человек — ответственный или соисполнитель.' },
  ];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr><th>Показатель</th><th>Единица</th><th>Период</th><th>Источник данных</th><th>Правило расчёта</th></tr></thead>
          <tbody>
            {defs.map((d) => <tr key={d.name}><td><b>{d.name}</b></td><td>{d.unit}</td><td>{d.period}</td><td>{d.source}</td><td className="small">{d.rule}</td></tr>)}
            {s.metrics.map((m) => <tr key={m.id}><td><span className="row"><Target size={14} className="muted" /><b>{m.name}</b></span></td><td>{m.unit}</td><td>месяц · план {m.monthlyPlan} на округ</td><td>Задачи, связанные с показателем</td><td className="small">{m.description} Учитывается после подтверждения. Вес в плане — {m.weight}.</td></tr>)}
          </tbody>
        </table>
      </div>
      <p className="small muted">Сейчас выбран период: {period.label.toLowerCase()} ({fmtDayMonth(period.from)} — {fmtDayMonth(period.to)}). Сравнение с прошлым периодом той же длины.</p>
    </div>
  );
}

/* ───────── Сводка по округам: задачи и медиа в одной таблице ───────── */
function OkrugSummary() {
  const s = useAppState();
  const period = usePeriod();
  const L = useLookup();
  const pd = useJson<PdData>('media-pd', 60000);
  const rows = useMemo(() => rateDistricts(s, period.from, period.to), [s, period]);
  const months = useMemo(() => (pd.data ? [...new Set(pd.data.posts.map((p) => p[0].slice(0, 7)))].sort() : []), [pd.data]);
  const pdMonth = months.includes(period.to.slice(0, 7)) ? period.to.slice(0, 7) : months[months.length - 1];
  const A = useMemo(() => (pd.data && pdMonth ? compute(pd.data, pdMonth) : null), [pd.data, pdMonth]);
  const data = rows.map((r) => {
    const g = A?.groups.find((x) => x.id === r.districtId);
    const writing = g ? g.mem.filter((a) => a.okPosts).length : 0;
    return {
      r, overdue: s.tasks.filter((t) => t.districtId === r.districtId && isOverdue(t)).length,
      pts: g?.pts ?? null, posts: g?.posts ?? null, writing: g && g.roster ? writing / g.roster : null, roster: g?.roster ?? 0, writers: writing,
    };
  }).sort((a, b) => (L.districts.get(a.r.districtId)?.num ?? 0) - (L.districts.get(b.r.districtId)?.num ?? 0));
  // цвет ячейки: место значения среди округов (лучше — насыщеннее), для просрочек — наоборот
  const shade = (vals: (number | null)[], v: number | null, invert = false) => {
    if (v === null) return undefined;
    const xs = vals.filter((x): x is number => x !== null);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    let t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    if (invert) t = 1 - t;
    return { background: `rgba(20,168,156,${0.08 + t * 0.55})` };
  };
  const col = <K extends keyof (typeof data)[number]>(k: K) => data.map((d) => d[k] as unknown as number | null);
  const plan = data.map((d) => (d.r.assigned.length ? d.r.plan : null));
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>Задачи — за период «{period.label.toLowerCase()}»; «Пиши-Делись» — за {pdMonth ? `${pdMonth.slice(5)}.${pdMonth.slice(0, 4)}` : 'последний месяц'}. Чем насыщеннее ячейка, тем лучше округ относительно остальных (для просрочек — меньше лучше). Нажмите на округ, чтобы открыть его страницу.</p>
      <div className="card table-wrap">
        <table className="tbl heat">
          <thead><tr><th>Округ</th><th className="right">План</th><th className="right">Выполнение задач</th><th className="right">Вовремя</th><th className="right">Просрочено</th><th className="right">Баллы ПД</th><th className="right">Посты ПД</th><th className="right">Пишут</th><th className="right">Оценка</th></tr></thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.r.districtId} className="clickable" onClick={() => go(`/team/districts/${d.r.districtId}`)}>
                <td className="t-title nowrap">{L.dname(d.r.districtId)}</td>
                <td className="hc" style={shade(plan, plan[i])}>{d.r.assigned.length ? pct(d.r.plan) : '—'}</td>
                <td className="hc" style={shade(data.map((x) => (x.r.assigned.length ? x.r.completion : null)), d.r.assigned.length ? d.r.completion : null)}>{d.r.assigned.length ? pct(d.r.completion) : '—'}</td>
                <td className="hc" style={shade(data.map((x) => (x.r.done.length ? x.r.onTime : null)), d.r.done.length ? d.r.onTime : null)}>{d.r.done.length ? pct(d.r.onTime) : '—'}</td>
                <td className="hc" style={shade(col('overdue'), d.overdue, true)}>{d.overdue}</td>
                <td className="hc" style={shade(col('pts'), d.pts)}>{d.pts === null ? (pd.error ? '—' : '…') : num(d.pts)}</td>
                <td className="hc" style={shade(col('posts'), d.posts)}>{d.posts === null ? '—' : num(d.posts)}</td>
                <td className="hc" style={shade(col('writing'), d.writing)} title={`${d.writers} из ${d.roster}`}>{d.writing === null ? '—' : pct(d.writing)}</td>
                <td className="hc" style={shade(data.map((x) => x.r.score), d.r.score)}>{d.r.score === null ? '—' : Math.round(d.r.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
