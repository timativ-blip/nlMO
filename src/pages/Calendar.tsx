import { Ban, CalendarDays, ChevronLeft, ChevronRight, Clock, Edit3, Gift, Link2, MapPin, Plus, Target, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isOverdue } from '../data/calc';
import * as P from '../data/perm';
import { cancelEvent, defaultEventStart, saveEvent, useAppState, validateEvent, type EventInput } from '../data/store';
import type { CalEvent, EventType } from '../data/types';
import { EVENT_TYPE_LABEL } from '../data/types';
import { addDays, addMonths, fmtDayLong, fmtDayMonth, fmtMonth, fmtRange, fmtStamp, fmtTime, monthEnd, monthStart, todayISO, WD_SHORT, weekStart } from '../lib/date';
import type { Route } from '../lib/router';
import { openEvent, openNewEvent, openNewTask, openTask, useGlobal } from '../ui/global';
import { useLookup, useMe } from '../ui/hooks';
import { Avatar, Button, Drawer, Empty, Field, Input, Modal, run, Segmented, Select, Textarea } from '../ui/kit';
import { PeoplePicker } from '../ui/widgets';

type Kind = EventType | 'deadline' | 'birthday';
interface Item { id: string; kind: Kind; date: string; time: string; title: string; onClick: () => void; late?: boolean; cancelled?: boolean }
const KIND_LABEL: Record<Kind, string> = { ...EVENT_TYPE_LABEL, deadline: 'Дедлайны задач', birthday: 'Дни рождения' };

function useItems(districtF: string, kinds: Set<Kind>) {
  const s = useAppState();
  const me = useMe();
  return useMemo(() => {
    const out: Item[] = [];
    for (const e of s.events) {
      if (!P.canSeeEvent(me, e) || !kinds.has(e.type)) continue;
      if (districtF && e.districtId !== districtF && e.districtId !== null) continue;
      out.push({ id: e.id, kind: e.type, date: e.start.slice(0, 10), time: fmtTime(e.start), title: e.title, onClick: () => openEvent(e.id), cancelled: e.cancelled });
    }
    // Дедлайны берутся из задач — без ручного ввода
    if (kinds.has('deadline'))
      for (const t of s.tasks) {
        if (t.status === 'done' || t.status === 'cancelled' || !P.canSeeTask(me, t)) continue;
        if (me.role !== 'member' && districtF && t.districtId !== districtF) continue;
        if (me.role === 'member' && !(t.assigneeId === me.id || t.coAssigneeIds.includes(me.id))) continue;
        out.push({ id: t.id, kind: 'deadline', date: t.due, time: '', title: t.title, onClick: () => openTask(t.id), late: isOverdue(t) });
      }
    if (kinds.has('birthday')) {
      const y = +todayISO().slice(0, 4);
      for (const u of s.users) {
        if (!P.canSeeBirthday(me, u)) continue;
        if (districtF && u.districtId !== districtF) continue;
        for (const yy of [y - 1, y, y + 1]) out.push({ id: `${u.id}-${yy}`, kind: 'birthday', date: `${yy}-${u.birthday!.slice(5)}`, time: '', title: u.name, onClick: () => (location.hash = `#/team/people/${u.id}`) });
      }
    }
    return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }, [s.events, s.tasks, s.users, me, districtF, kinds]);
}

export default function CalendarPage({ route }: { route: Route }) {
  const s = useAppState();
  const me = useMe();
  const [view, setView] = useState<'month' | 'week' | 'list'>(() => (window.innerWidth < 900 ? 'list' : 'month'));
  const [anchor, setAnchor] = useState(todayISO());
  const [districtF, setDistrictF] = useState(me.role === 'member' ? '' : '');
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(['event', 'meeting', 'training', 'deadline', 'birthday']));
  const items = useItems(districtF, kinds);
  useEffect(() => { if (route.parts[1]) openEvent(route.parts[1]); }, [route.parts[1]]);
  const today = todayISO();
  const toggleKind = (k: Kind) => { const n = new Set(kinds); n.has(k) ? n.delete(k) : n.add(k); setKinds(n); };
  const shift = (n: number) => setAnchor(view === 'month' ? addMonths(anchor, n) : addDays(anchor, 7 * n));
  const title = view === 'month' ? fmtMonth(anchor) : view === 'week' ? fmtRange(weekStart(anchor), addDays(weekStart(anchor), 6)) : 'Ближайшие 30 дней';

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Календарь</h1><div className="sub">Мероприятия, встречи, дедлайны задач и дни рождения</div></div>
        <Segmented label="Вид календаря" value={view} onChange={setView} options={[{ value: 'month', label: 'Месяц' }, { value: 'week', label: 'Неделя' }, { value: 'list', label: 'Список' }]} />
        {P.canCreateEvent(me) && <Button variant="primary" icon={Plus} onClick={() => openNewEvent({})} className="hide-sm">Мероприятие</Button>}
      </div>
      <div className="toolbar">
        {view !== 'list' && <div className="row"><Button size="sm" iconOnly icon={ChevronLeft} aria-label="Назад" onClick={() => shift(-1)} /><Button size="sm" onClick={() => setAnchor(today)}>Сегодня</Button><Button size="sm" iconOnly icon={ChevronRight} aria-label="Вперёд" onClick={() => shift(1)} /></div>}
        <h2 style={{ minWidth: 160 }}>{title}</h2>
        <span className="spacer" />
        {(P.isManager(me) || me.role === 'coordinator') && <select className="select select-sm" style={{ width: 160 }} value={districtF} onChange={(e) => setDistrictF(e.target.value)} aria-label="Округ"><option value="">Все округа</option>{s.districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
      </div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <button key={k} className={`chip ${kinds.has(k) ? 'on' : ''}`} aria-pressed={kinds.has(k)} onClick={() => toggleKind(k)}><span className={`ev ev-${k}`} style={{ width: 10, height: 10, padding: 0, borderRadius: 3 }} />{KIND_LABEL[k]}</button>)}
      </div>
      {view === 'month' && <MonthView anchor={anchor} items={items} canCreate={P.canCreateEvent(me)} />}
      {view === 'week' && <WeekView anchor={anchor} items={items} />}
      {view === 'list' && <ListView items={items.filter((i) => i.date >= today && i.date <= addDays(today, 30))} />}
    </>
  );
}

function Chip({ i }: { i: Item }) {
  return (
    <button className={`ev ev-${i.kind} ${i.late ? 'late' : ''} ${i.cancelled ? 'cancelled' : ''}`} onClick={(e) => { e.stopPropagation(); i.onClick(); }} title={`${KIND_LABEL[i.kind]}: ${i.title}`} aria-label={`${KIND_LABEL[i.kind]}: ${i.title}${i.time ? ', ' + i.time : ''}`}>
      {i.kind === 'birthday' && <Gift size={11} style={{ flex: 'none' }} />}
      {i.kind === 'deadline' && <Target size={11} style={{ flex: 'none' }} />}
      <span>{i.time && <b>{i.time} </b>}{i.title}</span>
    </button>
  );
}

function MonthView({ anchor, items, canCreate }: { anchor: string; items: Item[]; canCreate: boolean }) {
  const start = weekStart(monthStart(anchor));
  const end = addDays(weekStart(monthEnd(anchor)), 6);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const today = todayISO();
  const [more, setMore] = useState<string | null>(null);
  const byDay = useMemo(() => { const m = new Map<string, Item[]>(); items.forEach((i) => m.set(i.date, [...(m.get(i.date) ?? []), i])); return m; }, [items]);
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="cal-grid">
        {WD_SHORT.map((w) => <div key={w} className="cal-wd">{w}</div>)}
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          return (
            <div key={d} className={`cal-cell ${d.slice(0, 7) !== anchor.slice(0, 7) ? 'other' : ''} ${d === today ? 'today' : ''}`} onDoubleClick={() => canCreate && openNewEvent({ date: d })} onClick={() => window.innerWidth < 900 && list.length && setMore(d)}>
              <span className="cal-day">{+d.slice(8)}</span>
              <div className="ev-wrap col" style={{ gap: 3 }}>{list.slice(0, 3).map((i) => <Chip key={i.kind + i.id} i={i} />)}</div>
              {list.length > 3 && <button className="more-link" onClick={(e) => { e.stopPropagation(); setMore(d); }}>ещё {list.length - 3}</button>}
            </div>
          );
        })}
      </div>
      <Modal open={!!more} onClose={() => setMore(null)} title={more ? fmtDayLong(more) : ''}>
        <div className="col" style={{ gap: 6 }}>{(more ? byDay.get(more) ?? [] : []).map((i) => <Chip key={i.kind + i.id} i={i} />)}</div>
      </Modal>
      {canCreate && <div className="small muted" style={{ padding: '8px 14px' }}>Двойной клик по дню — новое мероприятие на эту дату.</div>}
    </div>
  );
}

function WeekView({ anchor, items }: { anchor: string; items: Item[] }) {
  const ws = weekStart(anchor);
  const today = todayISO();
  return (
    <div className="week-grid">
      {Array.from({ length: 7 }, (_, k) => addDays(ws, k)).map((d) => {
        const list = items.filter((i) => i.date === d);
        return (
          <div key={d} className={`week-col ${d === today ? 'today' : ''}`}>
            <div className="row"><b>{WD_SHORT[(k(d, ws))]}</b><span className="muted">{fmtDayMonth(d)}</span></div>
            {list.length === 0 && <span className="small muted">Свободно</span>}
            {list.map((i) => <Chip key={i.kind + i.id} i={i} />)}
          </div>
        );
      })}
    </div>
  );
}
const k = (d: string, ws: string) => Math.round((Date.parse(d) - Date.parse(ws)) / 864e5);

function ListView({ items }: { items: Item[] }) {
  const groups = useMemo(() => { const m = new Map<string, Item[]>(); items.forEach((i) => m.set(i.date, [...(m.get(i.date) ?? []), i])); return [...m.entries()]; }, [items]);
  if (!groups.length) return <div className="card"><Empty icon={CalendarDays} title="Ближайший месяц свободен" text="Включите другие типы событий или создайте мероприятие." /></div>;
  return (
    <div className="col" style={{ gap: 12 }}>
      {groups.map(([d, list]) => (
        <div key={d} className="card">
          <div className="card-head"><h3>{d === todayISO() ? 'Сегодня, ' : ''}{fmtDayLong(d)}</h3></div>
          <div className="card-body" style={{ padding: '8px 0 6px' }}>
            {list.map((i) => (
              <button key={i.kind + i.id} className="list-item" onClick={i.onClick}>
                <span className={`ev ev-${i.kind}`} style={{ width: 10, height: 34, padding: 0, flex: 'none', borderRadius: 4 }} />
                <div className="grow"><div className="title ellipsis" style={{ textDecoration: i.cancelled ? 'line-through' : undefined, color: i.late ? 'var(--c-danger)' : undefined }}>{i.title}</div><div className="small muted">{KIND_LABEL[i.kind]}{i.time ? ` · ${i.time}` : ''}{i.late ? ' · просрочено' : ''}{i.cancelled ? ' · отменено' : ''}</div></div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────── Мероприятие: просмотр ───────── */
export function EventDrawer() {
  const g = useGlobal();
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const [edit, setEdit] = useState(false);
  const e = s.events.find((x) => x.id === g.eventId);
  if (!g.eventId) return null;
  const close = () => { openEvent(null); if (location.hash.startsWith('#/calendar/')) location.replace('#/calendar'); };
  if (!e || !P.canSeeEvent(me, e)) return <Drawer open onClose={close} head={<b>Мероприятие недоступно</b>}><p>Мероприятие не найдено или не входит в доступные вам события.</p></Drawer>;
  const tasks = s.tasks.filter((t) => t.eventId === e.id && P.canSeeTask(me, t));
  const canEdit = P.canEditEvent(me, e) && !e.cancelled;
  return (
    <Drawer open onClose={close} head={<><span className={`badge ${e.cancelled ? 'st-cancelled' : 'badge-brand'}`}>{e.cancelled ? 'Отменено' : EVENT_TYPE_LABEL[e.type]}</span><span className="small muted">{L.dname(e.districtId)}</span></>}>
      <h1 style={{ fontSize: 22, overflowWrap: 'anywhere' }}>{e.title}</h1>
      {canEdit && <div className="row wrap" style={{ marginTop: 12 }}>
        <Button icon={Edit3} onClick={() => setEdit(true)}>Изменить</Button>
        {P.canCreateTask(me) && <Button icon={Plus} onClick={() => openNewTask({ eventId: e.id, districtId: e.districtId ?? undefined, due: e.start.slice(0, 10) >= todayISO() ? e.start.slice(0, 10) : todayISO(), title: `Подготовка: ${e.title}` })}>Задача к мероприятию</Button>}
        <Button variant="ghost" icon={Ban} onClick={() => confirm('Отменить мероприятие? Участники получат уведомление.') && run(() => cancelEvent(e.id), 'Мероприятие отменено, участники уведомлены')}>Отменить</Button>
      </div>}
      <dl className="meta-grid section">
        <dt><Clock size={14} /> Когда</dt><dd>{fmtDayLong(e.start.slice(0, 10))}, {fmtTime(e.start)}–{fmtTime(e.end)} <span className="small muted">МСК</span></dd>
        <dt><MapPin size={14} /> Место</dt><dd>{e.place || '—'}</dd>
        {e.link && <><dt><Link2 size={14} /> Ссылка</dt><dd><a href={e.link} target="_blank" rel="noreferrer" className="ellipsis" style={{ display: 'block' }}>{e.link}</a></dd></>}
        <dt>Ответственный</dt><dd className="row"><Avatar user={L.user(e.ownerId)} size={22} />{L.user(e.ownerId)?.name}</dd>
      </dl>
      {e.description && <div className="section"><h3>Описание</h3><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{e.description}</p></div>}
      <div className="section">
        <h3><Users size={16} />Участники · {e.participantIds.length}</h3>
        <div className="row wrap">{e.participantIds.slice(0, 40).map((id) => <span key={id} className="row badge badge-soft" style={{ height: 28 }}><Avatar user={L.user(id)} size={20} />{L.user(id)?.name}</span>)}</div>
      </div>
      <div className="section">
        <h3><Target size={16} />Связанные задачи</h3>
        {tasks.length === 0 ? <span className="muted">Нет связанных задач</span> : tasks.map((t) => <button key={t.id} className="list-item" style={{ padding: '8px 0' }} onClick={() => openTask(t.id)}><span className="grow ellipsis">{t.title}</span><span className={`badge st-${t.status}`}>{t.status === 'done' ? 'Выполнена' : t.status === 'review' ? 'На проверке' : 'В работе'}</span></button>)}
      </div>
      {e.history.length > 0 && <div className="section"><h3>История</h3><div className="timeline">{[...e.history].reverse().map((h, i) => <div key={i}><b>{L.user(h.userId)?.name}</b> — {h.text}<div className="small muted">{fmtStamp(h.at)}</div></div>)}</div></div>}
      {edit && <EventForm event={e} onClose={() => setEdit(false)} />}
    </Drawer>
  );
}

/* ───────── Мероприятие: создание и редактирование ───────── */
export function NewEventModal() {
  const g = useGlobal();
  if (!g.newEvent) return null;
  return <EventForm prefill={g.newEvent} onClose={() => openNewEvent(null)} />;
}

function EventForm({ event, prefill, onClose }: { event?: CalEvent; prefill?: { date?: string; districtId?: string }; onClose: () => void }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const init = (): EventInput => event
    ? { ...event, taskIds: s.tasks.filter((t) => t.eventId === event.id).map((t) => t.id) }
    : { title: '', type: 'event', start: prefill?.date ? `${prefill.date}T12:00` : defaultEventStart(), end: prefill?.date ? `${prefill.date}T14:00` : defaultEventStart().replace('12:00', '14:00'), place: '', link: '', ownerId: me.id, participantIds: [me.id], districtId: prefill?.districtId ?? (me.role === 'coordinator' ? me.districtId : null), description: '', taskIds: [] };
  const [v, setV] = useState<EventInput>(init);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (p: Partial<EventInput>) => { setV((x) => ({ ...x, ...p })); setErrs({}); };
  const date = v.start.slice(0, 10);
  const users = s.users.filter((u) => u.active && (P.isManager(me) || u.districtId === me.districtId || u.districtId === null));
  const tasks = s.tasks.filter((t) => P.canSeeTask(me, t) && t.status !== 'cancelled' && (!v.districtId || t.districtId === v.districtId) && (t.status !== 'done' || v.taskIds?.includes(t.id))).slice(0, 80);
  const save = () => {
    const e = validateEvent(v);
    if (Object.keys(e).length) { setErrs(e); return; }
    let id = '';
    if (run(() => { id = saveEvent(v, event?.id); }, event ? 'Изменения сохранены, участники уведомлены' : `Мероприятие создано и появилось в календарях ${v.participantIds.length} участников`)) { onClose(); if (!event) openEvent(id); }
  };
  return (
    <Modal open onClose={onClose} title={event ? 'Изменить мероприятие' : 'Новое мероприятие'} width={640} footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>{event ? 'Сохранить' : 'Создать'}</Button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Название" required error={errs.title}><Input autoFocus value={v.title} invalid={!!errs.title} onChange={(e) => set({ title: e.target.value })} placeholder="Например: Субботник в парке" /></Field>
        <div className="grid g-3" style={{ gap: 12 }}>
          <Field label="Тип"><Select value={v.type} onChange={(e) => set({ type: e.target.value as EventType })} options={(Object.keys(EVENT_TYPE_LABEL) as EventType[]).map((k) => ({ value: k, label: EVENT_TYPE_LABEL[k] }))} /></Field>
          <Field label="Дата" required error={errs.start}><Input type="date" value={date} onChange={(e) => set({ start: `${e.target.value}T${v.start.slice(11)}`, end: `${e.target.value}T${v.end.slice(11)}` })} /></Field>
          <Field label="Округ" hint={me.role === 'coordinator' ? 'Только свой округ' : undefined}>
            <Select disabled={me.role === 'coordinator'} value={v.districtId ?? ''} onChange={(e) => set({ districtId: e.target.value || null })} options={[{ value: '', label: 'Вся область' }, ...s.districts.map((d) => ({ value: d.id, label: d.name }))]} />
          </Field>
          <Field label="Начало (МСК)"><Input type="time" value={v.start.slice(11)} onChange={(e) => set({ start: `${date}T${e.target.value}` })} /></Field>
          <Field label="Окончание" error={errs.end}><Input type="time" value={v.end.slice(11)} invalid={!!errs.end} onChange={(e) => set({ end: `${date}T${e.target.value}` })} /></Field>
          <Field label="Ответственный"><Select value={v.ownerId} onChange={(e) => set({ ownerId: e.target.value })} options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
        </div>
        <div className="grid g-2" style={{ gap: 12 }}>
          <Field label="Место" error={errs.place}><Input value={v.place} invalid={!!errs.place} onChange={(e) => set({ place: e.target.value })} placeholder="Адрес" /></Field>
          <Field label="Ссылка" hint="Для онлайн-встреч"><Input value={v.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://…" /></Field>
        </div>
        <div className="field">
          <div className="row"><span className="label grow">Участники — событие появится в их календарях</span>{v.districtId && <Button size="sm" variant="ghost" onClick={() => set({ participantIds: [...new Set([...v.participantIds, ...s.users.filter((u) => u.districtId === v.districtId).map((u) => u.id)])] })}>+ вся команда {L.dname(v.districtId)}</Button>}</div>
          <PeoplePicker value={v.participantIds} onChange={(x) => set({ participantIds: x })} users={users} />
        </div>
        <Field label="Описание"><Textarea rows={3} value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="field">
          <span className="label">Связанные задачи</span>
          <div className="card" style={{ maxHeight: 150, overflowY: 'auto', padding: '4px 10px', borderRadius: 12 }}>
            {tasks.length === 0 && <span className="small muted">Нет подходящих задач в этом округе</span>}
            {tasks.map((t) => <label key={t.id} className="check" style={{ display: 'flex', padding: '4px 0' }}><input type="checkbox" checked={!!v.taskIds?.includes(t.id)} onChange={() => set({ taskIds: v.taskIds?.includes(t.id) ? v.taskIds.filter((x) => x !== t.id) : [...(v.taskIds ?? []), t.id] })} /><span className="ellipsis grow">{t.title}</span><span className="small muted nowrap">{fmtDayMonth(t.due)}</span></label>)}
          </div>
        </div>
      </div>
    </Modal>
  );
}
