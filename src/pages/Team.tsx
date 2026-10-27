import { ArrowLeft, CalendarDays, FileText, Gift, Mail, MapPin, Phone, Plus, Search, Send, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ACTIVE, isOverdue, kpis, num, pct, rateDistricts, taskPoints, districtMonthlyPlan } from '../data/calc';
import * as P from '../data/perm';
import { useAppState } from '../data/store';
import type { Role } from '../data/types';
import { roleLabel, teamRoleOf, TEAM_ROLES } from '../data/types';
import { addDays, fmtDate, fmtDayMonth, fmtTime, todayISO } from '../lib/date';
import { go, type Route } from '../lib/router';
import { openEvent, openNewEvent, openNewTask, openRecords } from '../ui/global';
import { useLookup, useMe, usePeriod } from '../ui/hooks';
import { Avatar, Bar, Button, Empty, ReportBadge, Tabs } from '../ui/kit';
import { ContextBar, MoMap, TaskRow } from '../ui/widgets';
import { AddPersonButton, PersonAdminCard, Requests, usePendingRequests } from './TeamAdmin';

export default function TeamPage({ route }: { route: Route }) {
  const [, sub, id] = route.parts;
  if (sub === 'people' && id) return <PersonPage id={id} />;
  if (sub === 'districts' && id) return <DistrictPage id={id} />;
  const tab = sub === 'districts' ? 'districts' : sub === 'requests' ? 'requests' : 'people';
  const me = useMe();
  const pending = usePendingRequests();
  const canApprove = me.role === 'head' || me.role === 'coordinator';
  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Команда</h1><div className="sub">Люди и команды округов Московской области</div></div>
        <ContextBar showDistrict={false} />
      </div>
      <Tabs value={tab} onChange={(v) => go(`/team/${v}`)} tabs={[{ value: 'people', label: 'Люди' }, { value: 'districts', label: 'Округа' }, ...(canApprove ? [{ value: 'requests', label: pending.length ? `Заявки · ${pending.length}` : 'Заявки' }] : [])]} />
      {tab === 'people' ? <People /> : tab === 'requests' && canApprove ? <Requests /> : <Districts />}
    </>
  );
}

function People() {
  const s = useAppState();
  const L = useLookup();
  const me = useMe();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [district, setDistrict] = useState('');
  const list = useMemo(() => s.users.filter((u) => !u.pending && (u.active || me.role === 'head') && (!q || `${u.name} ${u.position} ${u.email}`.toLowerCase().includes(q.toLowerCase())) && (!role || teamRoleOf(u) === role) && (!district || u.districtId === district)).sort((a, b) => ['head', 'staff', 'coordinator', 'member'].indexOf(a.role) - ['head', 'staff', 'coordinator', 'member'].indexOf(b.role) || a.name.localeCompare(b.name)), [s.users, q, role, district, me.role]);
  const active = (id: string) => s.tasks.filter((t) => t.assigneeId === id && ACTIVE(t));
  return (
    <>
      <div className="toolbar">
        <div className="search-input"><Search size={15} /><input className="input" placeholder="Имя, направление, почта" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск людей" /></div>
        <select className="select select-sm" style={{ width: 190 }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Роль"><option value="">Все роли</option>{TEAM_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
        <select className="select select-sm" style={{ width: 160 }} value={district} onChange={(e) => setDistrict(e.target.value)} aria-label="Округ"><option value="">Все округа</option>{s.districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        {(q || role || district) && <Button size="sm" variant="ghost" onClick={() => { setQ(''); setRole(''); setDistrict(''); }}>Сбросить</Button>}
        <span className="spacer" /><span className="small muted">{list.length} чел.</span>
        <AddPersonButton />
      </div>
      {s.users.length <= 1 && <div className="callout info" style={{ marginBottom: 14 }}><Users size={16} />Пока в команде только вы. Добавьте координаторов и участников — по одному кнопкой «Добавить человека» или списком через импорт таблицы в настройках.</div>}
      {list.length === 0 ? <div className="card"><Empty icon={Users} title="Никого не нашли" text="Проверьте написание или сбросьте фильтры." /></div> : (
        <div className="card table-wrap">
          <table className="tbl tbl-cards">
            <thead><tr><th>Человек</th><th>Роль</th><th>Округ</th><th className="hide-card">Контакты</th><th className="right">Активные задачи</th></tr></thead>
            <tbody>
              {list.map((u) => {
                const a = active(u.id);
                const o = a.filter((t) => isOverdue(t)).length;
                return (
                  <tr key={u.id} className="clickable" tabIndex={0} onClick={() => go(`/team/people/${u.id}`)} onKeyDown={(e) => e.key === 'Enter' && go(`/team/people/${u.id}`)}>
                    <td className="t-title"><span className="row"><Avatar user={u} size={34} /><span className="col" style={{ gap: 0 }}><span className="ellipsis">{u.name}{!u.active && <span className="badge st-cancelled" style={{ marginLeft: 6 }}>отключён</span>}</span><span className="small muted ellipsis" style={{ fontWeight: 400 }}>{u.position}</span></span></span></td>
                    <td><span className={`badge ${u.role === 'member' ? 'badge-soft' : 'badge-brand'}`}>{roleLabel(u)}</span></td>
                    <td className="nowrap">{L.dname(u.districtId)}</td>
                    <td className="hide-card small"><div>{u.phone}</div><div className="muted">{u.email}</div></td>
                    <td className="right nowrap"><b>{a.length}</b>{o > 0 && <span className="overdue-text small"> · {o} просрочено</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Districts() {
  const s = useAppState();
  const L = useLookup();
  const period = usePeriod();
  const rows = useMemo(() => rateDistricts(s, period.from, period.to), [s, period]);
  const lastWeek = addDays(rows.length ? s.reports.reduce((a, r) => (r.weekStart > a ? r.weekStart : a), '') : todayISO(), -7);
  return (
    <div className="grid g-main">
      <div className="card table-wrap">
        <table className="tbl tbl-cards">
          <thead><tr><th>Округ</th><th>Координатор</th><th className="right">Команда</th><th className="right">Активные</th><th className="right">Просрочки</th><th>План</th><th>Отчёт за прошлую неделю</th></tr></thead>
          <tbody>
            {rows.map((d) => {
              const dist = L.districts.get(d.districtId)!;
              const team = s.users.filter((u) => u.districtId === d.districtId && u.active).length;
              const active = s.tasks.filter((t) => t.districtId === d.districtId && ACTIVE(t)).length;
              const overdue = s.tasks.filter((t) => t.districtId === d.districtId && isOverdue(t)).length;
              const rep = s.reports.find((r) => r.districtId === d.districtId && r.weekStart === lastWeek);
              return (
                <tr key={d.districtId} className="clickable" tabIndex={0} onClick={() => go(`/team/districts/${d.districtId}`)} onKeyDown={(e) => e.key === 'Enter' && go(`/team/districts/${d.districtId}`)}>
                  <td className="t-title"><span className="ellipsis">{L.dname(d.districtId)}</span><span className="small muted" style={{ fontWeight: 400 }}>{dist.cities?.join(', ')}</span></td>
                  <td className="nowrap"><span className="row"><Avatar user={L.user(dist.coordinatorId)} size={24} />{L.user(dist.coordinatorId)?.name ?? (dist.coordinatorName ? <span className="muted">{dist.coordinatorName}</span> : <span className="muted">не назначен</span>)}</span></td>
                  <td className="right">{team}</td>
                  <td className="right">{active}</td>
                  <td className={`right ${overdue ? 'overdue-text' : ''}`}>{overdue}</td>
                  <td style={{ minWidth: 120 }}><div className="row"><span className="num" style={{ width: 44 }}>{d.assigned.length ? pct(d.plan) : '—'}</span><div className="grow"><Bar value={d.plan} /></div></div></td>
                  <td>{rep ? <ReportBadge status={rep.status} /> : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-head"><h2>Картограмма</h2></div>
        <div className="card-body">
          <MoMap values={Object.fromEntries(rows.map((d) => [d.districtId, d.assigned.length ? d.plan : null]))} onPick={(id) => go(`/team/districts/${id}`)} />
        </div>
      </div>
    </div>
  );
}

function PersonPage({ id }: { id: string }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const period = usePeriod();
  const u = L.user(id);
  if (!u) return <Empty icon={Users} title="Человек не найден" action={<Button onClick={() => go('/team')}>К списку команды</Button>} />;
  const tasks = s.tasks.filter((t) => (t.assigneeId === u.id || t.coAssigneeIds.includes(u.id)) && P.canSeeTask(me, t));
  const active = tasks.filter(ACTIVE).sort((a, b) => a.due.localeCompare(b.due));
  const done = tasks.filter((t) => t.assigneeId === u.id && t.status === 'done' && (t.confirmedAt ?? '') >= period.from && (t.confirmedAt ?? '') <= period.to);
  const points = done.reduce((a, t) => a + taskPoints(s, t), 0);
  const hiddenTasks = s.tasks.filter((t) => t.assigneeId === u.id && ACTIVE(t)).length - active.filter((t) => t.assigneeId === u.id).length;
  return (
    <>
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => history.back()} style={{ marginBottom: 10 }}>Назад</Button>
      <div className="card card-pad" style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <Avatar user={u} size={76} />
        <div className="grow">
          <h1>{u.name}</h1>
          <div className="row wrap" style={{ marginTop: 6 }}><span className="badge badge-brand">{roleLabel(u)}</span><span className="muted">{u.position}</span>{u.districtId && <a href={`#/team/districts/${u.districtId}`} className="row" style={{ gap: 4 }}><MapPin size={14} />{L.dname(u.districtId)}</a>}</div>
          <div className="row wrap" style={{ marginTop: 10, gap: 16 }}>
            <a href={`tel:${u.phone.replace(/[^\d+]/g, '')}`} className="row" style={{ gap: 5 }}><Phone size={14} />{u.phone}</a>
            <a href={`mailto:${u.email}`} className="row" style={{ gap: 5 }}><Mail size={14} />{u.email}</a>
            {u.telegram && <a href={`https://t.me/${u.telegram.replace('@', '')}`} target="_blank" rel="noreferrer" className="row" style={{ gap: 5 }}><Send size={14} />{u.telegram}</a>}
            {P.canSeeBirthday(me, u) && <span className="row muted" style={{ gap: 5 }}><Gift size={14} />{fmtDayMonth(u.birthday!)}</span>}
          </div>
        </div>
        <div className="row wrap">
          {me.id === u.id && <Button onClick={() => go('/profile')}>Редактировать профиль</Button>}
          {P.canCreateTask(me) && u.districtId && P.canAssignIn(me, u.districtId) && <Button variant="primary" icon={Plus} onClick={() => openNewTask({ assigneeId: u.id, districtId: u.districtId! })}>Поставить задачу</Button>}
        </div>
      </div>
      <PersonAdminCard u={u} />
      <div className="grid g-3" style={{ marginTop: 16 }}>
        <div className="kpi" style={{ cursor: 'default' }}><span className="kpi-label">Активные задачи</span><span className="kpi-value">{active.length}</span><span className="kpi-foot">{active.filter((t) => isOverdue(t)).length} просрочено</span></div>
        <button className="kpi" onClick={() => openRecords({ title: `Подтверждённые результаты: ${u.name}`, rule: 'Задачи, где человек — ответственный, подтверждённые в выбранном периоде.', tasks: done, cellValue: (t) => taskPoints(s, t).toFixed(1) })}><span className="kpi-label">Подтверждено · {period.label.toLowerCase()}</span><span className="kpi-value">{done.length}</span><span className="kpi-foot">Открыть список</span></button>
        <div className="kpi" style={{ cursor: 'default' }}><span className="kpi-label">Баллы результатов</span><span className="kpi-value">{num(points)}</span><span className="kpi-foot">вес приоритета × срок сдачи</span></div>
      </div>
      <div className="grid g-2" style={{ marginTop: 16 }}>
        <div className="card"><div className="card-head"><h2>Текущие задачи</h2></div><div className="card-body" style={{ padding: '8px 0' }}>
          {active.length ? active.map((t) => <TaskRow key={t.id} t={t} />) : <Empty icon={FileText} title="Активных задач нет" />}
          {hiddenTasks > 0 && <div className="small muted" style={{ padding: '8px 20px' }}>Ещё {hiddenTasks} задач вне вашей зоны доступа.</div>}
        </div></div>
        <div className="card"><div className="card-head"><h2>Подтверждённые результаты</h2><span className="small muted">{period.label}</span></div><div className="card-body" style={{ padding: '8px 0' }}>
          {done.length ? done.map((t) => <TaskRow key={t.id} t={t} right={<span className="small muted nowrap">{fmtDate(t.confirmedAt)}</span>} />) : <Empty icon={FileText} title="Нет подтверждённых результатов" text="За выбранный период. Смените период вверху страницы." />}
        </div></div>
      </div>
    </>
  );
}

function DistrictPage({ id }: { id: string }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const period = usePeriod();
  const d = L.districts.get(id);
  const k = useMemo(() => kpis(s, period.from, period.to, id), [s, period, id]);
  if (!d) return <Empty icon={MapPin} title="Округ не найден" action={<Button onClick={() => go('/team/districts')}>Ко всем округам</Button>} />;
  const team = s.users.filter((u) => u.districtId === id && u.active);
  const coord = L.user(d.coordinatorId);
  const active = s.tasks.filter((t) => t.districtId === id && ACTIVE(t) && P.canSeeTask(me, t)).sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || a.due.localeCompare(b.due));
  const today = todayISO();
  const events = s.events.filter((e) => (e.districtId === id || e.districtId === null) && !e.cancelled && e.start.slice(0, 10) >= today && P.canSeeEvent(me, e)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
  const reports = s.reports.filter((r) => r.districtId === id && P.canSeeReport(me, r)).sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 4);
  return (
    <>
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => go('/team/districts')} style={{ marginBottom: 10 }}>Все округа</Button>
      <div className="page-head">
        <div className="grow"><h1>{d.num ? `${d.num} округ · ` : 'Округ '}{d.name}</h1><div className="sub">Координатор: {coord ? <a href={`#/team/people/${coord.id}`}>{coord.name}</a> : d.coordinatorName ? <>{d.coordinatorName} <span className="muted">(по таблице, ещё нет учётной записи)</span></> : 'не назначен'} · команда {team.length} чел.</div>{d.cities?.length ? <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>{d.cities.map((c) => <span key={c} className="pill">{c}</span>)}</div> : null}</div>
        <ContextBar showDistrict={false} />
        {P.canAssignIn(me, id) && <Button variant="primary" icon={Plus} onClick={() => openNewTask({ districtId: id })}>Задача</Button>}
        {P.canCreateEvent(me) && (P.isManager(me) || me.districtId === id) && <Button icon={CalendarDays} onClick={() => openNewEvent({ districtId: id })}>Мероприятие</Button>}
      </div>
      <div className="grid g-4">
        <button className="kpi" onClick={() => go('/analytics')}><span className="kpi-label">Выполнение плана</span><span className="kpi-value">{pct(k.plan)}</span><Bar value={k.plan} /></button>
        <button className="kpi" onClick={() => openRecords({ title: `Подтверждено: ${d.name}`, tasks: k.confirmed })}><span className="kpi-label">Подтверждено</span><span className="kpi-value">{k.confirmed.length}</span><span className="kpi-foot">из {k.assigned.length} назначенных</span></button>
        <button className="kpi" onClick={() => openRecords({ title: `Вовремя: ${d.name}`, tasks: k.onTimeRecords })}><span className="kpi-label">Вовремя</span><span className="kpi-value">{k.onTimeShare === null ? '—' : pct(k.onTimeShare)}</span></button>
        <button className="kpi" onClick={() => openRecords({ title: `Просрочено: ${d.name}`, tasks: k.overdue })}><span className="kpi-label">Просрочено</span><span className="kpi-value" style={{ color: k.overdue.length ? 'var(--c-danger)' : undefined }}>{k.overdue.length}</span></button>
      </div>
      <div className="grid g-main" style={{ marginTop: 16 }}>
        <div className="col" style={{ gap: 16 }}>
          <div className="card"><div className="card-head"><h2 className="grow">Активные задачи</h2><Button size="sm" variant="ghost" onClick={() => go(`/tasks?district=${id}`)}>Все</Button></div><div className="card-body" style={{ padding: '8px 0' }}>
            {active.length ? active.slice(0, 8).map((t) => <TaskRow key={t.id} t={t} />) : <Empty icon={FileText} title="Активных задач нет" />}
          </div></div>
          <div className="card"><div className="card-head"><h2>Показатели</h2><span className="small muted">{period.label}</span></div><div className="card-body">
            {k.facts.map((f) => (
              <button key={f.metric.id} className="hbar-row" style={{ gridTemplateColumns: '170px 1fr 90px' }} onClick={() => openRecords({ title: `${f.metric.name}: ${d.name}`, rule: `Сумма значений из подтверждённых задач, связанных с показателем. План округа: ${districtMonthlyPlan(f.metric, d.id)} ${f.metric.unit} в месяц (назначает руководство в «Аналитика → Показатели»), пропорционально длине периода.`, tasks: f.records, cellValue: (t) => String(t.result?.value ?? 0) })}>
                <span className="ellipsis">{f.metric.name}</span>
                <Bar value={f.pct} />
                <span className="right small"><b>{num(f.fact)}</b> / {f.plan}</span>
              </button>
            ))}
          </div></div>
        </div>
        <div className="col" style={{ gap: 16 }}>
          <div className="card"><div className="card-head"><h2>Команда</h2></div><div className="card-body" style={{ padding: '8px 0' }}>
            {team.map((u) => <button key={u.id} className="list-item" onClick={() => go(`/team/people/${u.id}`)}><Avatar user={u} size={30} /><div className="grow"><div className="title ellipsis">{u.name}</div><div className="small muted">{u.role === 'coordinator' ? 'Координатор' : u.position}</div></div><span className="small muted">{s.tasks.filter((t) => t.assigneeId === u.id && ACTIVE(t)).length} задач</span></button>)}
          </div></div>
          <div className="card"><div className="card-head"><h2>Ближайшие мероприятия</h2></div><div className="card-body" style={{ padding: '8px 0' }}>
            {events.length ? events.map((e) => <button key={e.id} className="list-item" onClick={() => openEvent(e.id)}><CalendarDays size={18} className="muted" /><div className="grow"><div className="title ellipsis">{e.title}</div><div className="small muted">{fmtDayMonth(e.start)}, {fmtTime(e.start)}</div></div></button>) : <Empty icon={CalendarDays} title="Мероприятий не запланировано" />}
          </div></div>
          <div className="card"><div className="card-head"><h2>Последние отчёты</h2></div><div className="card-body" style={{ padding: '8px 0' }}>
            {reports.length ? reports.map((r) => <button key={r.id} className="list-item" onClick={() => go(`/reports/${r.id}`)}><FileText size={18} className="muted" /><span className="grow">Неделя с {fmtDayMonth(r.weekStart)}</span><ReportBadge status={r.status} /></button>) : <Empty icon={FileText} title="Отчётов пока нет" />}
          </div></div>
        </div>
      </div>
    </>
  );
}
