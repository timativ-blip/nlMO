import { queueReport } from '../data/report-delivery';
import { ReportDeliveryStatus, useReportOperations } from '../ui/ReportDelivery';
// Ежедневные отчёты о работе: штаб, медиа-штаб, координаторы и заместители.
// Напоминание в 18:00 МСК по будням приходит тем, кто ещё не сдал (колокольчик + Telegram).
import { CheckCircle2, ClipboardCheck, Save, Search } from 'lucide-react';
import { DraftNotice, useDraft } from '../ui/drafts';
import { useEffect, useMemo, useState } from 'react';
import * as P from '../data/perm';
import { useAppState } from '../data/store';
import { roleLabel, type DailyReport, type User } from '../data/types';
import { addDays, fmtDayLong, fmtDayMonth, fmtStamp, todayISO, WD_SHORT, weekday } from '../lib/date';
import { go, useRoute } from '../lib/router';
import { dailyCoverage, MetricValue } from '../ui/metricSources';
import { openRecords } from '../ui/global';
import { useLookup, useMe } from '../ui/hooks';
import { Avatar, Button, Empty, Field, run, Select, Textarea, toast } from '../ui/kit';

const isWorkday = (d: string) => weekday(d) < 5;

export default function DailyPage() {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const route = useRoute();
  const today = todayISO();
  const canFill = me.role !== 'member';
  const isReviewer = me.role === 'head' || me.role === 'coordinator';
  // кого видно: себя, всех (руководство) или свой округ (координатор и заместитель)
  const required = useMemo(() => s.users.filter((u) => u.active && P.mustReportDaily(u) && P.canSeeDaily(me, u)), [s.users, me]);
  const visible = useMemo(() => s.dailyReports.filter((r) => P.canSeeDaily(me, L.user(r.userId))), [s.dailyReports, me, L]);
  const detailId = route.parts[1];
  if (detailId) {
    const report = visible.find(r => encodeURIComponent(r.id) === detailId || r.id === detailId);
    return <><Button variant="ghost" onClick={() => go('/daily')}>Все отчёты дня</Button>
      {report ? <section className="card card-pad col" style={{gap:12}}>
        <h1>{L.user(report.userId)?.name ?? 'Отчёт дня'}</h1>
        <p className="muted">{fmtDayLong(report.day)} · сохранён {fmtStamp(report.updatedAt)}</p>
        <h2>Что сделано</h2><p className="metric-report-text">{report.done}</p>
        {report.plan && <><h2>План</h2><p className="metric-report-text">{report.plan}</p></>}
        {report.problems && <><h2>Проблемы</h2><p className="metric-report-text">{report.problems}</p></>}
      </section> : <Empty icon={ClipboardCheck} title="Отчёт недоступен" text="Запись отсутствует или недоступна вашей роли."/>}
    </>;
  }

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Отчёт дня</h1><div className="sub">{fmtDayLong(today)} · что сделано за день, планы и проблемы</div></div>
      </div>
      <div className={isReviewer ? 'grid g-main' : ''}>
        <div className="col" style={{ gap: 16 }}>
          {canFill ? <DailyReportForm /> : <div className="card"><Empty icon={ClipboardCheck} title="Ежедневный отчёт не нужен" text="Его заполняют штаб, координаторы и заместители." /></div>}
          {isReviewer && <Feed reports={visible} />}
        </div>
        {isReviewer && <TodayStatus required={required} />}
      </div>
      {isReviewer && <DailyHeat required={required} />}
      {!isReviewer && canFill && <MyHistory />}
    </>
  );
}

export function DailyReportForm() {
  const s = useAppState();
  const me = useMe();
  const today = todayISO();
  const [day, setDay] = useState(today);
  const existing = s.dailyReports.find((r) => r.userId === me.id && r.day === day);
  const draft = useDraft(`daily:${day}`, { done: existing?.done ?? '', plan: existing?.plan ?? '', problems: existing?.problems ?? '' }, existing?.updatedAt ?? '');
  const v = draft.value, setV = draft.set;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => setErr(''), [day]);
  const {rows} = useReportOperations();
  const pending = rows.some(op => op.entity === `daily:${day}` && op.status !== 'sent');
  const days = [today, addDays(today, -1), addDays(today, -2)];
  const save = async () => {
    if (busy || pending) return;
    if (v.done.trim().length < 10) { setErr('Опишите, что сделано за день — хотя бы одно предложение.'); return; }
    setBusy(true);
    try {
      await queueReport({kind:'daily',day,intent:'save',fields:v,baseRevision:draft.baseRevision || null});
      toast('Отчёт сохранён на устройстве и поставлен в очередь');
    } catch (error) { setErr((error as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card card-pad col" style={{ gap: 12 }}>
      <div className="row wrap">
        <h2 className="grow">Мой отчёт</h2>
        {existing ? <span className="badge st-done"><CheckCircle2 size={12} />сдан {fmtStamp(existing.updatedAt).split(', ')[1]}</span> : P.mustReportDaily(me) ? <span className="badge st-review">ещё не сдан</span> : <span className="badge">по желанию</span>}
        <Select className="select-sm" style={{ width: 170 }} value={day} onChange={(e) => setDay(e.target.value)} options={days.map((d) => ({ value: d, label: d === today ? 'Сегодня' : d === addDays(today, -1) ? 'Вчера' : fmtDayMonth(d) }))} aria-label="День отчёта" />
      </div>
      <DraftNotice draft={draft} />
      <ReportDeliveryStatus entity={`daily:${day}`} />
      <Field label="Что сделано" required error={err}><Textarea rows={4} value={v.done} invalid={!!err} onChange={(e) => { setV({ ...v, done: e.target.value }); setErr(''); }} placeholder="Встречи, публикации, обращения, мероприятия — коротко и по делу" /></Field>
      <div className="grid g-2" style={{ gap: 12 }}>
        <Field label="План на завтра"><Textarea rows={2} value={v.plan} onChange={(e) => setV({ ...v, plan: e.target.value })} /></Field>
        <Field label="Проблемы, нужна помощь"><Textarea rows={2} value={v.problems} onChange={(e) => setV({ ...v, problems: e.target.value })} /></Field>
      </div>
      <div className="row"><Button disabled={busy || pending} variant="primary" icon={Save} onClick={save}>{busy ? 'Сохраняю…' : pending ? 'Ждёт подтверждения' : existing ? 'Обновить отчёт' : 'Сдать отчёт'}</Button><span className="small muted">Напоминание приходит в 18:00 по будням, если отчёт не сдан.</span></div>
    </div>
  );
}

function TodayStatus({ required }: { required: User[] }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const today = todayISO();
  const doneIds = new Set(s.dailyReports.filter((r) => r.day === today).map((r) => r.userId));
  const sorted = [...required].sort((a, b) => Number(doneIds.has(a.id)) - Number(doneIds.has(b.id)) || a.name.localeCompare(b.name, 'ru'));
  const n = required.filter((u) => doneIds.has(u.id)).length;
  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">Сдали сегодня</h2><MetricValue className="num" records={dailyCoverage(me,required,[today],s.dailyReports)}>{n} / {required.length}</MetricValue></div>
      <div className="card-body" style={{ padding: '6px 0' }}>
        {!isWorkday(today) && <div className="small muted" style={{ padding: '0 20px 8px' }}>Сегодня выходной — отчёт по желанию.</div>}
        {sorted.map((u) => (
          <button key={u.id} className="list-item" onClick={() => openRecords(dailyCoverage(me,[u],[today],s.dailyReports))}>
            <Avatar user={u} size={28} />
            <span className="grow"><span className="title ellipsis" style={{ display: 'block' }}>{u.name}</span><span className="small muted ellipsis" style={{ display: 'block' }}>{roleLabel(u)}{u.districtId ? ` · ${L.dname(u.districtId)}` : ''}</span></span>
            {doneIds.has(u.id) ? <span className="badge st-done">сдал(а)</span> : <span className="badge st-overdue">нет</span>}
          </button>
        ))}
        {!required.length && <Empty icon={ClipboardCheck} title="Некого проверять" text="Здесь появятся сотрудники, которые сдают ежедневный отчёт." />}
      </div>
    </div>
  );
}

function Feed({ reports }: { reports: DailyReport[] }) {
  const L = useLookup();
  const today = todayISO();
  const [day, setDay] = useState(today);
  const [q, setQ] = useState('');
  const list = reports.filter((r) => r.day === day && (!q || `${L.user(r.userId)?.name} ${r.done} ${r.plan} ${r.problems}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const days = Array.from({ length: 7 }, (_, k) => addDays(today, -k));
  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">Лента отчётов</h2></div>
      <div className="card-body col" style={{ gap: 10 }}>
        <div className="row wrap">
          <div className="seg" role="radiogroup" aria-label="День">{days.map((d) => <button key={d} role="radio" aria-checked={d === day} className={d === day ? 'on' : ''} onClick={() => setDay(d)}>{d === today ? 'Сегодня' : `${WD_SHORT[weekday(d)]} ${+d.slice(8)}`}</button>)}</div>
          <div className="search-input"><Search size={15} /><input className="input" placeholder="Поиск по тексту и людям" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по отчётам" /></div>
        </div>
        {!list.length ? <Empty icon={ClipboardCheck} title="Отчётов за этот день нет" /> : list.map((r) => {
          const u = L.user(r.userId);
          return (
            <article key={r.id} className="post-card">
              <div className="row"><Avatar user={u} size={26} /><b className="grow">{u?.name}</b><span className="small muted">{u ? roleLabel(u) : ''}{u?.districtId ? ` · ${L.dname(u.districtId)}` : ''} · {fmtStamp(r.updatedAt).split(', ')[1]}</span></div>
              <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{r.done}</p>
              {r.plan && <p className="small" style={{ margin: '6px 0 0' }}><b>План:</b> {r.plan}</p>}
              {r.problems && <div className="callout warn small" style={{ marginTop: 8 }}><b>Проблемы:</b>&nbsp;{r.problems}</div>}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** Тепловая карта «человек × рабочий день» за 3 недели: сдал отчёт или нет */
function DailyHeat({ required }: { required: User[] }) {
  const s = useAppState();
  const me = useMe();
  const today = todayISO();
  const days = Array.from({ length: 21 }, (_, k) => addDays(today, -20 + k)).filter(isWorkday);
  const has = new Set(s.dailyReports.map((r) => `${r.userId}|${r.day}`));
  const rows = required.map((u) => ({ u, n: days.filter((d) => has.has(`${u.id}|${d}`)).length })).sort((a, b) => a.n - b.n);
  if (!rows.length) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h2 className="grow">Дисциплина отчётов · 3 недели</h2><span className="legend"><span><i style={{ background: 'var(--teal)' }} />сдан</span><span><i style={{ background: 'var(--bg-danger)' }} />не сдан</span></span></div>
      <div className="card-body table-wrap">
        <table className="heatgrid">
          <thead><tr><th />{days.map((d) => <th key={d} title={fmtDayLong(d)}>{+d.slice(8)}</th>)}<th className="right">Сдано</th></tr></thead>
          <tbody>
            {rows.map(({ u, n }) => (
              <tr key={u.id}>
                <td className="hg-name ellipsis">{u.name}</td>
                {days.map((d) => <td key={d}><button type="button" className={`hg-cell ${has.has(`${u.id}|${d}`) ? 'on' : d === today ? 'today' : 'off'}`} title={`${u.name}, ${fmtDayMonth(d)}: ${has.has(`${u.id}|${d}`) ? 'сдан' : 'не сдан'}`} aria-label={`${u.name}, ${fmtDayMonth(d)}`} onClick={() => openRecords(dailyCoverage(me,[u],[d],s.dailyReports))} /></td>)}
                <td className="right num"><MetricValue records={dailyCoverage(me,[u],days,s.dailyReports)}>{Math.round((n / days.length) * 100)}%</MetricValue></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MyHistory() {
  const s = useAppState();
  const me = useMe();
  const mine = s.dailyReports.filter((r) => r.userId === me.id).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14);
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h2>Мои отчёты</h2></div>
      <div className="card-body col" style={{ gap: 10 }}>
        {!mine.length ? <Empty icon={ClipboardCheck} title="Отчётов пока нет" /> : mine.map((r) => <article key={r.id} className="post-card"><b>{fmtDayLong(r.day)}</b><p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{r.done}</p></article>)}
      </div>
    </div>
  );
}
