import { CheckSquare, Columns3, FilterX, List, MessageSquare, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isOverdue } from '../data/calc';
import * as P from '../data/perm';
import { setTaskStatus, setUi, updateTask, useAppState } from '../data/store';
import type { Priority, Task, TaskStatus } from '../data/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '../data/types';
import { addDays, fmtDate, fmtDayMonth, relDue, todayISO, weekStart } from '../lib/date';
import type { Route } from '../lib/router';
import { openNewTask, openTask } from '../ui/global';
import { useLookup, useMe } from '../ui/hooks';
import { Avatar, Button, Empty, PriorityTag, run, Segmented, TaskStatusBadges, toast } from '../ui/kit';
import { ReturnModal, SubmitModal } from './TaskPanels';
import { confirmTask } from '../data/store';
import TaskWorkflows from './TaskWorkflows';

type DueFilter = '' | 'today' | 'week' | 'next' | 'none';
interface Filters { q: string; mine: boolean; district: string; assignee: string; status: string; due: DueFilter; priority: string; overdue: boolean }
const EMPTY: Filters = { q: '', mine: false, district: '', assignee: '', status: 'active', due: '', priority: '', overdue: false };
const FKEY = 'kc-task-filters';

export default function TasksPage({ route }: { route: Route }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const [workflowTab, setWorkflowTab] = useState<'launch' | 'templates' | null>(null);
  const [f, setF] = useState<Filters>(() => {
    try { return { ...EMPTY, ...(JSON.parse(sessionStorage.getItem(FKEY) || 'null') ?? (me.role === 'member' ? { mine: true } : {})) }; } catch { return EMPTY; }
  });
  useEffect(() => { try { sessionStorage.setItem(FKEY, JSON.stringify(f)); } catch { /* приватный режим */ } }, [f]);
  // Фильтры из ссылок (например, с главной: ?overdue=1)
  useEffect(() => {
    const q = route.query;
    if ([...q.keys()].length) setF({ ...EMPTY, mine: q.get('mine') === '1', overdue: q.get('overdue') === '1', status: q.get('status') ?? (q.get('overdue') ? '' : 'active'), district: q.get('district') ?? '', assignee: q.get('assignee') ?? '' });
  }, [route.query.toString()]); // eslint-disable-line
  useEffect(() => { if (route.parts[1]) openTask(route.parts[1]); }, [route.parts[1]]);

  const view = s.ui.taskView;
  const set = (p: Partial<Filters>) => setF((x) => ({ ...x, ...p }));
  const today = todayISO();
  const visible = useMemo(() => s.tasks.filter((t) => P.canSeeTask(me, t)), [s.tasks, me]);
  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const we = addDays(weekStart(today), 6);
    return visible.filter((t) => {
      if (q && !(t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || L.user(t.assigneeId)?.name.toLowerCase().includes(q))) return false;
      if (f.mine && !(t.assigneeId === me.id || t.coAssigneeIds.includes(me.id))) return false;
      if (f.district && t.districtId !== f.district) return false;
      if (f.assignee && t.assigneeId !== f.assignee) return false;
      if (f.status === 'active' && !(t.status === 'new' || t.status === 'in_progress' || t.status === 'review')) return false;
      if (f.status && f.status !== 'active' && t.status !== f.status) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.overdue && !isOverdue(t)) return false;
      if (f.due === 'today' && t.due !== today) return false;
      if (f.due === 'week' && !(t.due >= weekStart(today) && t.due <= we)) return false;
      if (f.due === 'next' && !(t.due > we && t.due <= addDays(we, 7))) return false;
      return true;
    }).sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || a.due.localeCompare(b.due));
  }, [visible, f, me, L, today]);

  const activeCount = (Object.keys(EMPTY) as (keyof Filters)[]).filter((k) => f[k] !== EMPTY[k]).length;
  const districts = s.districts.filter((d) => P.isManager(me) || d.id === me.districtId);
  const assignees = s.users.filter((u) => visible.some((t) => t.assigneeId === u.id)).sort((a, b) => a.name.localeCompare(b.name));
  const overdueCount = visible.filter((t) => isOverdue(t)).length;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Задачи</h1>
          <div className="sub">{me.role === 'member' ? 'Ваши задачи и задачи, где вы соисполнитель' : me.role === 'coordinator' ? `Задачи округа ${L.dname(me.districtId)}` : 'Все задачи области'}</div>
        </div>
        <Segmented label="Вид" value={view} onChange={(v) => setUi({ taskView: v })} options={[{ value: 'list', label: 'Список', icon: List }, { value: 'kanban', label: 'Канбан', icon: Columns3 }]} />
        {P.canCreateTask(me) && <><Button onClick={() => setWorkflowTab('launch')}>По округам</Button><Button onClick={() => setWorkflowTab('templates')}>Шаблоны и повторения</Button><Button variant="primary" icon={Plus} onClick={() => openNewTask()} className="hide-sm">Новая задача <span className="kbd" style={{ color: '#d9f3ef', borderColor: 'rgba(255,255,255,.3)', background: 'transparent' }}>N</span></Button></>}
      </div>

      <div className="toolbar" role="search">
        <div className="search-input">
          <Search size={15} />
          <input className="input" placeholder="Поиск по задачам и людям" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Поиск по задачам" />
        </div>
        <button className={`chip ${f.mine ? 'on' : ''}`} aria-pressed={f.mine} onClick={() => set({ mine: !f.mine })}>Мои задачи</button>
        <button className={`chip ${f.overdue ? 'on' : ''}`} aria-pressed={f.overdue} onClick={() => set({ overdue: !f.overdue, status: !f.overdue ? '' : 'active' })}>Просроченные{overdueCount ? ` · ${overdueCount}` : ''}</button>
        {districts.length > 1 && <select className="select select-sm" style={{ width: 150 }} value={f.district} onChange={(e) => set({ district: e.target.value })} aria-label="Округ"><option value="">Все округа</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        <select className="select select-sm" style={{ width: 170 }} value={f.assignee} onChange={(e) => set({ assignee: e.target.value })} aria-label="Ответственный"><option value="">Все ответственные</option>{assignees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        {view === 'list' && <select className="select select-sm" style={{ width: 150 }} value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Статус"><option value="active">Активные</option><option value="">Все статусы</option>{(Object.keys(STATUS_LABEL) as TaskStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select>}
        <select className="select select-sm" style={{ width: 150 }} value={f.due} onChange={(e) => set({ due: e.target.value as DueFilter })} aria-label="Срок"><option value="">Любой срок</option><option value="today">Сегодня</option><option value="week">Эта неделя</option><option value="next">Следующая неделя</option></select>
        <select className="select select-sm" style={{ width: 140 }} value={f.priority} onChange={(e) => set({ priority: e.target.value })} aria-label="Приоритет"><option value="">Любой приоритет</option>{(Object.keys(PRIORITY_LABEL) as Priority[]).map((k) => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}</select>
        {activeCount > 0 && <Button variant="ghost" size="sm" icon={FilterX} onClick={() => setF(EMPTY)}>Сбросить ({activeCount})</Button>}
      </div>

      {view === 'list' ? <TaskTable list={list} hasFilters={activeCount > 0} onReset={() => setF(EMPTY)} /> : <Kanban list={list.concat(f.status === 'active' ? [] : [])} all={visible} filters={f} />}
      {workflowTab && <TaskWorkflows initial={workflowTab} onClose={() => setWorkflowTab(null)} />}
    </>
  );
}

function TaskTable({ list, hasFilters, onReset }: { list: Task[]; hasFilters: boolean; onReset: () => void }) {
  const me = useMe();
  const L = useLookup();
  const s = useAppState();
  const [limit, setLimit] = useState(60);
  if (!list.length)
    return <div className="card"><Empty icon={CheckSquare} title={hasFilters ? 'По фильтрам ничего не найдено' : 'Задач пока нет'} text={hasFilters ? 'Измените условия или сбросьте фильтры.' : P.canCreateTask(me) ? 'Создайте первую задачу — это займёт меньше минуты.' : 'Когда вам назначат задачу, она появится здесь, а вы получите уведомление.'} action={hasFilters ? <Button icon={FilterX} onClick={onReset}>Сбросить фильтры</Button> : P.canCreateTask(me) ? <Button variant="primary" icon={Plus} onClick={() => openNewTask()}>Новая задача</Button> : null} /></div>;
  return (
    <div className="card table-wrap">
      <table className="tbl tbl-cards">
        <thead><tr><th>Задача</th><th>Ответственный</th><th>Срок</th><th className="hide-card">Приоритет</th><th>Статус</th></tr></thead>
        <tbody>
          {list.slice(0, limit).map((t) => {
            const canEdit = P.canEditTask(me, t) && t.status !== 'done' && t.status !== 'cancelled';
            const people = s.users.filter((u) => u.active && (P.isManager(me) ? u.districtId === t.districtId || u.districtId === null : u.districtId === me.districtId));
            const stop = (e: React.SyntheticEvent) => e.stopPropagation();
            const checks = t.checklist.length ? `${t.checklist.filter((c) => c.done).length}/${t.checklist.length}` : '';
            return (
              <tr key={t.id} className="clickable" onClick={() => openTask(t.id)} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && openTask(t.id)} tabIndex={0}>
                <td className="t-title">
                  <span className="ellipsis">{t.title}</span>
                  <span className="small muted row" style={{ gap: 10, fontWeight: 400 }}>
                    <span>{L.dname(t.districtId)}</span>
                    {checks && <span className="row" style={{ gap: 3 }}><CheckSquare size={12} />{checks}</span>}
                    {t.comments.length > 0 && <span className="row" style={{ gap: 3 }}><MessageSquare size={12} />{t.comments.length}</span>}
                  </span>
                </td>
                <td onClick={canEdit ? stop : undefined}>
                  {canEdit ? (
                    <select className="select select-sm inline-select" style={{ maxWidth: 190 }} value={t.assigneeId} aria-label={`Ответственный: ${t.title}`} onChange={(e) => run(() => updateTask(t.id, { assigneeId: e.target.value }), 'Ответственный изменён')}>
                      {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  ) : <span className="row nowrap"><Avatar user={L.user(t.assigneeId)} size={22} />{L.user(t.assigneeId)?.name}</span>}
                </td>
                <td onClick={canEdit ? stop : undefined} className="nowrap">
                  {canEdit ? (
                    <input type="date" className={`input input-sm inline-select ${isOverdue(t) ? 'overdue-text' : ''}`} style={{ width: 140 }} value={t.due} aria-label={`Срок: ${t.title}`} onChange={(e) => e.target.value && run(() => updateTask(t.id, { due: e.target.value }), 'Срок изменён')} />
                  ) : <span className={isOverdue(t) ? 'overdue-text' : ''}>{fmtDate(t.due)}</span>}
                  {!canEdit && <div className="small muted">{relDue(t.due)}</div>}
                </td>
                <td className="hide-card"><PriorityTag p={t.priority} /></td>
                <td onClick={canEdit && (t.status === 'new' || t.status === 'in_progress') ? stop : undefined}>
                  {canEdit && (t.status === 'new' || t.status === 'in_progress') ? (
                    <select className={`select select-sm inline-select badge st-${t.status}`} style={{ width: 128, height: 28 }} value={t.status} aria-label={`Статус: ${t.title}`} onChange={(e) => {
                      const v = e.target.value as TaskStatus;
                      if (v === 'cancelled' || v === 'review') { openTask(t.id); return; }
                      run(() => setTaskStatus(t.id, v as 'new' | 'in_progress'), `Статус: ${STATUS_LABEL[v]}`);
                    }}>
                      <option value="new">Новая</option><option value="in_progress">В работе</option><option value="cancelled">Отменить…</option>
                    </select>
                  ) : <TaskStatusBadges t={t} />}
                  {canEdit && isOverdue(t) && <div className="small overdue-text">просрочена</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.length > limit && <div style={{ padding: 12, textAlign: 'center' }}><Button onClick={() => setLimit(limit + 60)}>Показать ещё ({list.length - limit})</Button></div>}
    </div>
  );
}

const COLS: TaskStatus[] = ['new', 'in_progress', 'review', 'done'];
function Kanban({ list, all, filters }: { list: Task[]; all: Task[]; filters: Filters }) {
  const me = useMe();
  const L = useLookup();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [submitT, setSubmitT] = useState<Task | null>(null);
  const [returnT, setReturnT] = useState<Task | null>(null);
  const today = todayISO();
  // В канбане показываем все статусы; выполненные — за последние 14 дней
  const items = (filters.status === 'active' ? all.filter((t) => list.includes(t) || (t.status === 'done' && (t.confirmedAt ?? '') >= addDays(today, -14) && matchesBesidesStatus(t))) : list);
  function matchesBesidesStatus(t: Task) {
    return (!filters.mine || t.assigneeId === me.id || t.coAssigneeIds.includes(me.id)) && (!filters.district || t.districtId === filters.district) && (!filters.assignee || t.assigneeId === filters.assignee) && (!filters.q || t.title.toLowerCase().includes(filters.q.toLowerCase())) && !filters.overdue;
  }
  const cancelled = all.filter((t) => t.status === 'cancelled' && matchesBesidesStatus(t)).length;
  const drop = (status: TaskStatus) => {
    const t = all.find((x) => x.id === drag);
    setDrag(null); setOver(null);
    if (!t || t.status === status) return;
    if (status === 'in_progress' && t.status === 'new') return run(() => setTaskStatus(t.id, 'in_progress'), 'Задача в работе');
    if (status === 'new' && t.status === 'in_progress') return run(() => setTaskStatus(t.id, 'new'), 'Статус: Новая');
    if (status === 'review') return P.canSubmit(me, t) ? setSubmitT(t) : toast('На проверку отправляет ответственный — через «Сдать результат».', 'error');
    if (status === 'done') {
      if (!P.canReview(me, t)) return toast(t.status !== 'review' ? 'Выполнить можно только задачу на проверке: сначала исполнитель сдаёт результат.' : 'Подтверждает выполнение координатор округа или руководитель.', 'error');
      return run(() => confirmTask(t.id), 'Выполнение подтверждено');
    }
    if (t.status === 'review' && status === 'in_progress') return P.canReview(me, t) ? setReturnT(t) : toast('Вернуть на доработку может проверяющий.', 'error');
    toast('Такой переход статуса недоступен.', 'error');
  };
  return (
    <>
      <div className="kanban">
        {COLS.map((c) => {
          const col = items.filter((t) => t.status === c);
          return (
            <section key={c} className={`k-col ${over === c ? 'drop' : ''}`} aria-label={STATUS_LABEL[c]}
              onDragOver={(e) => { e.preventDefault(); setOver(c); }} onDragLeave={() => setOver(null)} onDrop={() => drop(c)}>
              <div className="k-head"><span className={`badge st-${c}`}><span className="dot" />{STATUS_LABEL[c]}</span><span className="muted">{col.length}</span>{c === 'done' && <span className="small muted" style={{ fontWeight: 400 }}>за 14 дней</span>}</div>
              {col.length === 0 && <div className="small muted" style={{ padding: '10px 6px' }}>{c === 'review' ? 'Нет результатов на проверке' : 'Пусто'}</div>}
              {col.slice(0, 40).map((t) => (
                <button key={t.id} className={`k-card ${drag === t.id ? 'dragging' : ''}`} draggable onDragStart={() => setDrag(t.id)} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => openTask(t.id)}>
                  <div className="title">{t.title}</div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="row" style={{ gap: 6 }}><Avatar user={L.user(t.assigneeId)} size={22} /><span className="small muted ellipsis" style={{ maxWidth: 110 }}>{L.dname(t.districtId)}</span></span>
                    <span className={`small nowrap ${isOverdue(t) ? 'overdue-text' : 'muted'}`}>{fmtDayMonth(t.due)}</span>
                  </div>
                  {(t.priority === 'high' || t.priority === 'urgent' || isOverdue(t) || t.returnedAt) && <div className="row" style={{ marginTop: 8, gap: 6 }}>{t.priority !== 'normal' && t.priority !== 'low' && <PriorityTag p={t.priority} />}{t.status === 'in_progress' && t.returnedAt && <span className="badge st-returned">Доработка</span>}{isOverdue(t) && <span className="badge st-overdue">Просрочена</span>}</div>}
                </button>
              ))}
              {col.length > 40 && <div className="small muted" style={{ padding: 6 }}>Ещё {col.length - 40} — уточните фильтры</div>}
            </section>
          );
        })}
      </div>
      <p className="small muted">Перетащите карточку, чтобы сменить статус. На проверку — через сдачу результата, в «Выполнена» — только после проверки. {cancelled > 0 && <>Отменённых задач: {cancelled} — их видно в списке с фильтром «Отменена».</>}</p>
      {submitT && <SubmitModal task={submitT} onClose={() => setSubmitT(null)} />}
      {returnT && <ReturnModal task={returnT} onClose={() => setReturnT(null)} />}
    </>
  );
}
