import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Clock, Gift, Inbox, RotateCcw, Sparkles, Target, Timer } from 'lucide-react';
import { firstName } from '../lib/names';
import { useMemo } from 'react';
import { ACTIVE, isOverdue, kpis, num, pct, rateDistricts, weeklyTrend } from '../data/calc';
import * as P from '../data/perm';
import { useAppState } from '../data/store';
import { EVENT_TYPE_LABEL } from '../data/types';
import { addDays, fmtAgo, fmtDayLong, fmtDayMonth, fmtTime, plural, todayISO, weekStart } from '../lib/date';
import { go } from '../lib/router';
import { openEvent, openRecords, openTask } from '../ui/global';
import { useLookup, useMe, usePeriod } from '../ui/hooks';
import { Avatar, Bar, Button, Empty, ReportBadge } from '../ui/kit';
import { HomeNudges } from '../ui/onboarding';
import { PulseMini } from './Pulse';
import { ContextBar, MoMap, TaskRow, TrendChart, useScopeDistrict } from '../ui/widgets';
import { AnimatedNumber, ProgressRing } from '../ui/charts';
import { StatCard } from './Insights';

export default function Home() {
  const me = useMe();
  const greeting = (() => { const h = +new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: 'numeric' }).format(new Date()); return h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; })();
  const manager = me.role !== 'member';
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <span className="eyebrow">Командный центр · Московская область</span>
          <h1>{greeting}, {firstName(me.name)}</h1>
          <div className="sub">{fmtDayLong(todayISO())} · {manager ? 'что происходит, что требует внимания и что делать дальше' : 'ваши задачи и ближайшие события'}</div>
        </div>
        {manager && <ContextBar />}
      </div>
      <HomeNudges />
      {manager ? <ManagerHome /> : null}
      <PersonalBlocks compact={manager} />
    </>
  );
}

function ManagerHome() {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const period = usePeriod();
  const districtId = useScopeDistrict();
  const k = useMemo(() => kpis(s, period.from, period.to, districtId), [s, period, districtId]);
  const prev = useMemo(() => kpis(s, period.prevFrom, period.prevTo, districtId), [s, period, districtId]);
  const trend = useMemo(() => weeklyTrend(s, 8, districtId), [s, districtId]);
  const dist = useMemo(() => rateDistricts(s, period.from, period.to), [s, period]);
  const scopeLabel = districtId ? `округ ${L.dname(districtId)}` : 'вся область';
  const review = k.review.filter((t) => P.canReview(me, t) || P.isManager(me));
  const myDistricts = me.role === 'coordinator' ? dist.filter((d) => d.districtId === me.districtId) : dist;

  return (
    <>
      <div className="home-bento">
        <section className="home-headline card" aria-label="Обзор работы">
          <div className="home-headline-copy">
            <span className="eyebrow"><span className="live-dot" />{period.label} · {scopeLabel}</span>
            <h2>Общая картина.<br /><span>Каждый результат на виду.</span></h2>
            <div className="home-plan"><AnimatedNumber value={k.plan * 100} suffix="%" /><span>плана выполнено</span></div>
            <p>{k.confirmed.length} подтверждённых результатов. {k.overdue.length ? `${k.overdue.length} задач требуют внимания к срокам.` : 'Все открытые задачи укладываются в срок.'}</p>
            <div className="row wrap"><Button variant="primary" onClick={() => go('/analytics')} icon={ArrowRight}>Открыть аналитику</Button><Button variant="ghost" onClick={() => openRecords({ title: 'Ожидают проверки', tasks: review })}>{review.length} на проверке</Button></div>
          </div>
          <ProgressRing value={k.plan} label="плана" />
        </section>
        <section className="card home-geography"><div className="card-head"><div><span className="eyebrow">12 округов · одна команда</span><h2>Московская область</h2></div><Button size="sm" variant="ghost" icon={ArrowRight} iconOnly aria-label="Открыть округа" onClick={() => go('/team/districts')} /></div><div className="card-body"><MoMap values={Object.fromEntries(dist.map((d) => [d.districtId, d.assigned.length ? d.plan : null]))} height={225} onPick={(id) => go(`/team/districts/${id}`)} /></div></section>
      </div>
      <div className="stat-grid">
        <StatCard label="Подтверждённые результаты" value={k.confirmed.length} icon={CheckCircle2} foot={`В прошлом периоде — ${prev.confirmed.length}`} trend={trend.map((p) => p.confirmed)} onClick={() => openRecords({ title: 'Подтверждённые результаты', rule: 'Задачи, подтверждённые в выбранном периоде.', tasks: k.confirmed })} />
        <StatCard label="Сдано вовремя" value={k.onTimeShare === null ? null : Math.round(k.onTimeShare * 100)} unit="%" icon={Timer} foot={k.onTimeShare === null ? 'Пока нет подтверждённых результатов' : `${k.onTimeRecords.length} из ${k.confirmed.length} результатов`} onClick={() => openRecords({ title: 'Результаты, сданные вовремя', tasks: k.onTimeRecords })} />
        <StatCard label="Просрочено сейчас" value={k.overdue.length} icon={AlertTriangle} warning={k.overdue.length > 0} foot="Открытые задачи на текущую дату" onClick={() => openRecords({ title: 'Просроченные задачи', tasks: k.overdue })} />
        <StatCard label="Ждут проверки" value={review.length} icon={CheckCircle2} foot="Результаты уже сданы командой" onClick={() => openRecords({ title: 'Ожидают проверки', tasks: review })} />
      </div>
      {me.role === 'head' && <PulseMini />}

      <div className="grid g-main" style={{ marginTop: 16 }}>
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2 className="grow">Динамика по неделям</h2><span className="small muted">{scopeLabel}</span></div>
            <div className="card-body"><TrendChart data={trend} onPick={(p) => openRecords({ title: `Подтверждено за неделю с ${fmtDayMonth(p.from)}`, tasks: kpis(s, p.from, p.to, districtId).confirmed })} /></div>
          </div>
          <div className="card">
            <div className="card-head"><h2 className="grow">Требует внимания</h2><Button size="sm" variant="ghost" onClick={() => go('/tasks?overdue=1')}>Все просрочки <ArrowRight size={14} /></Button></div>
            <div className="card-body" style={{ padding: '8px 0 6px' }}>
              {review.length === 0 && k.overdue.length === 0 && <Empty icon={Sparkles} title="Всё под контролем" text="Нет просрочек и результатов, ожидающих проверки." />}
              {review.slice(0, 4).map((t) => <TaskRow key={t.id} t={t} right={<span className="badge st-review">Проверить</span>} />)}
              {k.overdue.slice(0, 5).map((t) => <TaskRow key={t.id} t={t} />)}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2 className="grow">{me.role === 'coordinator' ? 'Мой округ' : 'Округа'}</h2><Button size="sm" variant="ghost" onClick={() => go('/team/districts')}>Все <ArrowRight size={14} /></Button></div>
          <div className="card-body" style={{ padding: '6px 0' }}>
            {myDistricts.map((d) => {
              const rep = s.reports.find((r) => r.districtId === d.districtId && r.weekStart === addDays(weekStart(todayISO()), -7));
              const overdue = s.tasks.filter((t) => t.districtId === d.districtId && isOverdue(t)).length;
              return (
                <button key={d.districtId} className="list-item" onClick={() => go(`/team/districts/${d.districtId}`)}>
                  <div className="grow col" style={{ gap: 5 }}>
                    <div className="row"><b className="grow">{d.name}</b><span className="num">{d.assigned.length ? pct(d.plan) : '—'}</span></div>
                    <Bar value={d.plan} />
                    <div className="row small muted">
                      <span>{d.done.length}/{d.assigned.length} задач</span>
                      {overdue > 0 && <span className="overdue-text">просрочено {overdue}</span>}
                      <span className="spacer" />
                      {rep && <ReportBadge status={rep.status} />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function PersonalBlocks({ compact }: { compact: boolean }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const today = todayISO();
  const weekEnd = addDays(weekStart(today), 6);
  const mine = s.tasks.filter((t) => t.assigneeId === me.id || t.coAssigneeIds.includes(me.id));
  const active = mine.filter(ACTIVE);
  const todayList = active.filter((t) => t.status !== 'review' && t.due <= today).sort((a, b) => a.due.localeCompare(b.due));
  const weekList = active.filter((t) => t.status !== 'review' && t.due > today && t.due <= addDays(today, 7)).sort((a, b) => a.due.localeCompare(b.due));
  const returned = active.filter((t) => t.status === 'in_progress' && t.returnedAt);
  const onReview = active.filter((t) => t.status === 'review');
  const events = s.events.filter((e) => !e.cancelled && P.canSeeEvent(me, e) && e.start.slice(0, 10) >= today && e.start.slice(0, 10) <= addDays(today, 14) && (e.participantIds.includes(me.id) || e.ownerId === me.id || e.districtId === me.districtId || e.districtId === null)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
  const bdays = s.users.filter((u) => P.canSeeBirthday(me, u) && (me.role !== 'member' || u.districtId === me.districtId || u.districtId === null)).map((u) => {
    let d = `${today.slice(0, 4)}-${u.birthday!.slice(5)}`;
    if (d < today) d = `${+today.slice(0, 4) + 1}-${u.birthday!.slice(5)}`;
    return { u, d };
  }).filter((x) => x.d <= addDays(today, 10)).sort((a, b) => a.d.localeCompare(b.d)).slice(0, 4);
  const changes = mine.flatMap((t) => [...t.history.map((h) => ({ t, at: h.at, text: h.text, userId: h.userId })), ...t.comments.map((c) => ({ t, at: c.at, text: `комментарий: ${c.text}`, userId: c.authorId }))]).filter((x) => x.userId !== me.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const hasPersonal = mine.length > 0;

  if (compact && !hasPersonal) return null;
  return (
    <div style={{ marginTop: compact ? 24 : 0 }}>
      {compact && <h2 style={{ marginBottom: 12 }}>Мои задачи</h2>}
      {returned.length > 0 && (
        <div className="callout danger" style={{ marginBottom: 16 }}>
          <RotateCcw size={18} style={{ flex: 'none', marginTop: 1 }} />
          <div className="grow"><b>Вернули на доработку: {returned.length}</b><div>{returned.map((t) => <div key={t.id}><a href={`#/tasks/${t.id}`} onClick={(e) => { e.preventDefault(); openTask(t.id); }}>{t.title}</a></div>)}</div></div>
        </div>
      )}
      <div className="grid g-main">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><Clock size={17} className="muted" /><h2 className="grow">Сегодня</h2><span className="small muted">{todayList.length ? `${todayList.length} ${plural(todayList.length, ['задача', 'задачи', 'задач'])}` : ''}</span></div>
            <div className="card-body" style={{ padding: '8px 0 6px' }}>
              {todayList.length ? todayList.map((t) => <TaskRow key={t.id} t={t} />) : <Empty icon={CheckCircle2} title="На сегодня всё" text="Задач со сроком на сегодня нет. Загляните в план на неделю." />}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><CalendarDays size={17} className="muted" /><h2 className="grow">Ближайшие 7 дней</h2><Button size="sm" variant="ghost" onClick={() => go('/tasks?mine=1')}>Все мои <ArrowRight size={14} /></Button></div>
            <div className="card-body" style={{ padding: '8px 0 6px' }}>
              {weekList.length ? weekList.map((t) => <TaskRow key={t.id} t={t} />) : <Empty icon={Inbox} title="Дедлайнов на неделе нет" text={`До ${fmtDayMonth(weekEnd)} свободно. Новые задачи появятся здесь автоматически.`} />}
            </div>
          </div>
          {onReview.length > 0 && (
            <div className="card">
              <div className="card-head"><h2 className="grow">Ждут проверки</h2></div>
              <div className="card-body" style={{ padding: '8px 0 6px' }}>{onReview.map((t) => <TaskRow key={t.id} t={t} />)}</div>
            </div>
          )}
        </div>
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2 className="grow">Ближайшие события</h2><Button size="sm" variant="ghost" onClick={() => go('/calendar')}>Календарь <ArrowRight size={14} /></Button></div>
            <div className="card-body" style={{ padding: '8px 0 6px' }}>
              {events.length === 0 && <Empty icon={CalendarDays} title="Событий нет" text="В ближайшие две недели ничего не запланировано." />}
              {events.map((e) => (
                <button key={e.id} className="list-item" onClick={() => openEvent(e.id)}>
                  <div style={{ width: 46, textAlign: 'center', flex: 'none' }}><div className="num" style={{ fontSize: 20 }}>{+e.start.slice(8, 10)}</div><div className="small muted">{fmtDayMonth(e.start).split(' ')[1]}</div></div>
                  <div className="grow"><div className="title ellipsis">{e.title}</div><div className="small muted ellipsis">{fmtTime(e.start)} · {EVENT_TYPE_LABEL[e.type]} · {e.place || 'онлайн'}</div></div>
                </button>
              ))}
              {bdays.map(({ u, d }) => (
                <button key={u.id} className="list-item" onClick={() => go(`/team/people/${u.id}`)}>
                  <div style={{ width: 46, display: 'grid', placeItems: 'center', flex: 'none' }}><Gift size={20} color="#b86a10" /></div>
                  <div className="grow"><div className="title ellipsis">День рождения: {u.name}</div><div className="small muted">{d === today ? 'сегодня' : fmtDayMonth(d)} · {L.dname(u.districtId)}</div></div>
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2 className="grow">Изменения по моим задачам</h2></div>
            <div className="card-body" style={{ padding: '8px 0 6px' }}>
              {changes.length === 0 && <Empty icon={Inbox} title="Пока тихо" text="Здесь появятся комментарии и решения по вашим задачам." />}
              {changes.map((c, i) => (
                <button key={i} className="list-item" onClick={() => openTask(c.t.id)}>
                  <Avatar user={L.user(c.userId)} size={28} />
                  <div className="grow"><div className="small ellipsis"><b>{L.user(c.userId)?.name}</b> {c.text}</div><div className="small muted ellipsis">{c.t.title} · {fmtAgo(c.at)}</div></div>
                </button>
              ))}
            </div>
          </div>
          {me.role === 'member' && <MyResultCard />}
        </div>
      </div>
    </div>
  );
}

function MyResultCard() {
  const s = useAppState();
  const me = useMe();
  const period = usePeriod();
  const done = s.tasks.filter((t) => t.assigneeId === me.id && t.status === 'done' && (t.confirmedAt ?? '') >= period.from && (t.confirmedAt ?? '') <= period.to);
  return (
    <button className="kpi" onClick={() => openRecords({ title: 'Мои подтверждённые результаты', tasks: done, cellValue: (t) => (t.result?.value !== undefined ? num(t.result.value) : '—') })}>
      <span className="kpi-label"><CheckCircle2 size={15} />Мои подтверждённые результаты · {period.label.toLowerCase()}</span>
      <span className="kpi-value">{done.length}</span>
      <span className="kpi-foot">Рейтинг и критерии — в разделе «Аналитика»</span>
    </button>
  );
}
