// «Пульс области»: зашёл — и сразу видно, где хорошо, где плохо и что будет к концу месяца.
// Источники: задачи (база), «Пиши-Делись» (media-pd), партийные группы (media-groups), ежедневные отчёты.
import { AlertTriangle, ArrowRight, CheckCircle2, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isOverdue, pct, rateDistricts, weeklyTrend } from '../data/calc';
import * as P from '../data/perm';
import { useAppState } from '../data/store';
import { addDays, fmtDayMonth, getPeriod, monthEnd, plural, todayISO, WD_SHORT, weekday, weekStart } from '../lib/date';
import { go } from '../lib/router';
import { useLookup } from '../ui/hooks';
import { Bar, Empty, Segmented } from '../ui/kit';
import { compute, useJson, type GroupsData, type PdData } from './Media';

type Light = 'green' | 'yellow' | 'red' | 'none';
interface Signal { key: string; label: string; value: string; light: Light; alert?: string; link: string }
const LIGHT_TXT: Record<Light, string> = { green: 'в норме', yellow: 'внимание', red: 'проблема', none: 'нет данных' };
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const lvl = (v: number | null, g: number, y: number, lowerIsBetter = false): Light => {
  if (v === null || Number.isNaN(v)) return 'none';
  if (lowerIsBetter) return v <= g ? 'green' : v <= y ? 'yellow' : 'red';
  return v >= g ? 'green' : v >= y ? 'yellow' : 'red';
};
const heatBg = (t: number | null) => (t === null ? '#eceae4' : `rgba(20,168,156,${0.08 + Math.max(0, Math.min(1, t)) * 0.82})`);

export default function PulsePage() {
  const s = useAppState();
  const L = useLookup();
  const pd = useJson<PdData>('media-pd', 60000);
  const gr = useJson<GroupsData>('media-groups', 5 * 60000);
  const today = todayISO();
  const month = today.slice(0, 7);
  const months = useMemo(() => (pd.data ? [...new Set(pd.data.posts.map((p) => p[0].slice(0, 7)))].sort() : []), [pd.data]);
  const pdMonth = months.includes(month) ? month : months[months.length - 1];
  const prevPdMonth = pdMonth ? months[months.indexOf(pdMonth) - 1] : undefined;
  const A = useMemo(() => (pd.data && pdMonth ? compute(pd.data, pdMonth) : null), [pd.data, pdMonth]);
  const Aprev = useMemo(() => (pd.data && prevPdMonth ? compute(pd.data, prevPdMonth) : null), [pd.data, prevPdMonth]);
  const period = getPeriod('month');
  const dist = useMemo(() => rateDistricts(s, period.from, period.to), [s, period]);
  const workdays = useMemo(() => { const out: string[] = []; for (let k = 0; out.length < 5 && k < 10; k++) { const d = addDays(today, -k); if (weekday(d) < 5) out.push(d); } return out; }, [today]);

  // доля прошедших дней месяца данных «Пиши-Делись» — для прогноза
  const elapsed = useMemo(() => {
    if (!pdMonth) return 1;
    const last = monthEnd(pdMonth + '-01');
    const end = pdMonth === month ? pdAsOf(pd.data) : last;
    return (+end.slice(8)) / (+last.slice(8));
  }, [pdMonth, month, pd.data]);

  const rows = useMemo(() => s.districts.map((d) => {
    const r = dist.find((x) => x.districtId === d.id);
    const g = A?.groups.find((x) => x.id === d.id);
    const gp = Aprev?.groups.find((x) => x.id === d.id);
    const overdue = s.tasks.filter((t) => t.districtId === d.id && isOverdue(t)).length;
    const writing = g && g.roster ? g.mem.filter((a) => a.okPosts).length / g.roster : null;
    const fRaw = g && gp && gp.pts ? g.pts / Math.max(elapsed, 0.05) / gp.pts : null;
    const forecast = fRaw !== null && fRaw <= 4 ? fRaw : null; // прошлый месяц неполный — не сравниваем
    const silent = gr.data ? gr.data.groups.filter((x) => x.okrug === d.id).reduce((n, x) => n + (['vk', 'tg'] as const).filter((k) => { const ch = x[k]; if (!ch || ch.status !== 'ok' || !ch.last) return ch?.status === 'empty'; return (Date.now() - Date.parse(ch.last)) / 864e5 >= 4; }).length, 0) : null;
    const req = s.users.filter((u) => u.active && u.districtId === d.id && P.mustReportDaily(u));
    const dailyShare = req.length ? req.reduce((n, u) => n + workdays.filter((wd) => s.dailyReports.some((x) => x.userId === u.id && x.day === wd)).length, 0) / (req.length * workdays.length) : null;
    const signals: Signal[] = [
      { key: 'plan', label: 'План задач', value: r && r.assigned.length ? pct(r.plan) : '—', light: r && r.assigned.length ? lvl(r.plan, 0.8, 0.5) : 'none', alert: r && r.assigned.length && r.plan < 0.5 ? `план задач выполнен на ${pct(r.plan)}` : undefined, link: `/team/districts/${d.id}` },
      { key: 'overdue', label: 'Просрочки', value: String(overdue), light: lvl(overdue, 0, 3, true), alert: overdue > 3 ? `${overdue} ${plural(overdue, ['просроченная задача', 'просроченные задачи', 'просроченных задач'])}` : undefined, link: `/tasks?overdue=1&district=${d.id}` },
      { key: 'writing', label: 'Пишут в ПД', value: writing === null ? '—' : pct(writing), light: lvl(writing, 0.7, 0.5), alert: writing !== null && writing < 0.5 ? `пишут только ${pct(writing)} из списка` : undefined, link: '/media/idle' },
      { key: 'trend', label: 'Прогноз ПД', value: forecast === null ? '—' : pct(forecast), light: lvl(forecast, 0.9, 0.7), alert: forecast !== null && forecast < 0.7 ? `при текущем темпе баллов ПД будет ${pct(forecast)} от прошлого месяца` : undefined, link: '/media/okr' },
      { key: 'groups', label: 'Молчат группы', value: silent === null ? '…' : String(silent), light: silent === null ? 'none' : lvl(silent, 0, 1, true), alert: silent !== null && silent >= 2 ? `${silent} ${plural(silent, ['группа молчит', 'группы молчат', 'групп молчат'])} 4+ дней` : undefined, link: '/media/groups' },
      { key: 'daily', label: 'Отчёты дня', value: dailyShare === null ? '—' : pct(dailyShare), light: lvl(dailyShare, 0.8, 0.5), alert: dailyShare !== null && dailyShare < 0.5 ? `ежедневные отчёты сданы на ${pct(dailyShare)} за 5 рабочих дней` : undefined, link: '/daily' },
    ];
    const reds = signals.filter((x) => x.light === 'red').length, yellows = signals.filter((x) => x.light === 'yellow').length;
    const overall: Light = reds >= 2 ? 'red' : reds || yellows >= 2 ? 'yellow' : signals.every((x) => x.light === 'none') ? 'none' : 'green';
    return { d, signals, overall, reds, yellows };
  }), [s, dist, A, Aprev, gr.data, elapsed, workdays]);

  const order: Record<Light, number> = { red: 0, yellow: 1, green: 2, none: 3 };
  const alerts = rows.flatMap((r) => r.signals.filter((x) => x.alert).map((x) => ({ d: r.d, x }))).sort((a, b) => order[a.x.light] - order[b.x.light]);
  const counts = { green: 0, yellow: 0, red: 0, none: 0 } as Record<Light, number>;
  rows.forEach((r) => counts[r.overall]++);

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Пульс области</h1><div className="sub">Светофор округов, тревоги и прогноз · задачи, «Пиши-Делись», группы и ежедневные отчёты</div></div>
        <div className="row wrap"><span className="badge st-done">в норме: {counts.green}</span><span className="badge st-review">внимание: {counts.yellow}</span><span className="badge st-overdue">проблема: {counts.red}</span></div>
      </div>

      <div className="lights">
        {[...rows].sort((a, b) => order[a.overall] - order[b.overall] || b.reds - a.reds || (a.d.num ?? 0) - (b.d.num ?? 0)).map((r) => (
          <button key={r.d.id} className={`light-card l-${r.overall}`} onClick={() => go(`/team/districts/${r.d.id}`)}>
            <div className="row"><span className={`ldot ${r.overall}`} /><b className="grow ellipsis">{L.dname(r.d.id)}</b><span className="small">{LIGHT_TXT[r.overall]}</span></div>
            <div className="light-signals">{r.signals.map((x) => <span key={x.key} className={`sig ${x.light}`} title={`${x.label}: ${x.value}`}><i />{x.label}<b>{x.value}</b></span>)}</div>
          </button>
        ))}
      </div>

      <div className="grid g-main" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><AlertTriangle size={17} /><h2 className="grow">Тревоги</h2><span className="small muted">{alerts.length}</span></div>
          <div className="card-body" style={{ padding: '6px 0' }}>
            {!alerts.length ? <Empty icon={CheckCircle2} title="Тревог нет" text="Все округа в норме по задачам, «Пиши-Делись», группам и отчётам." /> : alerts.slice(0, 14).map(({ d, x }, k) => (
              <button key={k} className="list-item" onClick={() => go(x.link)}>
                <span className={`ldot ${x.light}`} />
                <span className="grow"><b>{L.dname(d.id)}</b>: {x.alert}</span>
                <ArrowRight size={15} className="muted" />
              </button>
            ))}
          </div>
        </div>
        <Forecast A={A} Aprev={Aprev} elapsed={elapsed} pdMonth={pdMonth} dist={dist} />
      </div>

      <HeatOkrugWeek pd={pd.data} />
      <div className="grid g-2" style={{ marginTop: 16 }}>
        <ActivityCalendar pd={pd.data} />
        <WeekdayBars pd={pd.data} />
      </div>
      <HeatPeopleWeek pd={pd.data} />
      <Funnel pd={pd.data} />
      {pd.error && !pd.data && <p className="small muted">Данные «Пиши-Делись» сейчас недоступны — часть сигналов показана как «нет данных».</p>}
    </>
  );
}

function Forecast({ A, Aprev, elapsed, pdMonth, dist }: { A: ReturnType<typeof compute> | null; Aprev: ReturnType<typeof compute> | null; elapsed: number; pdMonth?: string; dist: ReturnType<typeof rateDistricts> }) {
  const assigned = dist.reduce((n, d) => n + d.assigned.length, 0);
  const planAvg = assigned ? dist.filter((d) => d.assigned.length).reduce((n, d) => n + d.plan, 0) / dist.filter((d) => d.assigned.length).length : null;
  const ptsNow = A ? A.people.reduce((n, a) => n + a.pts, 0) : 0;
  const postsNow = A ? A.P.length : 0;
  const ptsPrev = Aprev ? Aprev.people.reduce((n, a) => n + a.pts, 0) : 0;
  const postsPrev = Aprev ? Aprev.P.length : 0;
  const f = (now: number) => now / Math.max(elapsed, 0.05);
  const Row = ({ label, now, fc, prev }: { label: string; now: number; fc: number; prev: number }) => (
    <div className="fc-row">
      <span className="small muted">{label}</span>
      <div className="row"><b className="num" style={{ fontSize: 26 }}>{nf.format(fc)}</b><span className="small muted">прогноз · сейчас {nf.format(now)}</span></div>
      {prev > 0 && (Math.abs(fc / prev - 1) > 3
        ? <span className="small muted">в прошлом месяце — {nf.format(prev)} (данные неполные, сравнение не показываем)</span>
        : <><Bar value={fc / prev / 1.3} tone="ok" /><span className={`small ${fc >= prev ? 'delta-up' : 'delta-down'}`}>{fc >= prev ? '+' : ''}{Math.round((fc / prev - 1) * 100)}% к прошлому месяцу ({nf.format(prev)})</span></>)}
    </div>
  );
  return (
    <div className="card">
      <div className="card-head"><TrendingUp size={17} /><h2 className="grow">Прогноз на конец месяца</h2><span className="small muted">прошло {Math.round(elapsed * 100)}% месяца</span></div>
      <div className="card-body col" style={{ gap: 16 }}>
        <div className="fc-row"><span className="small muted">План задач по области (темп)</span><b className="num" style={{ fontSize: 26 }}>{planAvg === null ? '—' : pct(planAvg)}</b><span className="small muted">при текущем темпе к концу месяца — столько же: план считается пропорционально прошедшим дням</span></div>
        {A ? <><Row label={`Баллы «Пиши-Делись» · ${pdMonth ? new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(pdMonth + '-15')) : ''}`} now={ptsNow} fc={f(ptsNow)} prev={ptsPrev} /><Row label="Посты «Пиши-Делись»" now={postsNow} fc={f(postsNow)} prev={postsPrev} /></> : <div className="map-skel" style={{ height: 120 }} />}
      </div>
    </div>
  );
}

/* ───────── Тепловые карты ───────── */
/** Последняя дата в данных «Пиши-Делись»: таблицу обновляют не каждый день, окна считаем от неё */
const pdAsOf = (pd: PdData | null) => (pd && pd.posts.length ? pd.posts.reduce((m, p) => (p[0] > m ? p[0] : m), '') : todayISO());
function weeksBack(n: number, anchor = todayISO()) { const cur = weekStart(anchor); return Array.from({ length: n }, (_, k) => addDays(cur, -7 * (n - 1 - k))); }

function HeatOkrugWeek({ pd }: { pd: PdData | null }) {
  const s = useAppState();
  const L = useLookup();
  const [m, setM] = useState<'tasks' | 'pd'>('pd');
  const weeks = weeksBack(12, m === 'pd' ? pdAsOf(pd) : todayISO());
  const grid = useMemo(() => s.districts.map((d) => {
    if (m === 'tasks') {
      const tr = weeklyTrend(s, 12, d.id);
      return { d, vals: tr.map((w) => (w.assigned ? w.plan : null)), txt: tr.map((w) => (w.assigned ? pct(w.plan) : '—')) };
    }
    const counts = weeks.map(() => 0);
    if (pd) pd.posts.forEach((p) => { if (pd.people[p[4]]?.[1] !== d.id) return; const wi = weeks.indexOf(weekStart(p[0])); if (wi >= 0) counts[wi]++; });
    return { d, vals: counts.map((c) => c), txt: counts.map(String) };
  }), [s, m, pd, weeks.join()]); // eslint-disable-line
  const max = Math.max(1, ...grid.flatMap((r) => r.vals.filter((v): v is number => v !== null)));
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h2 className="grow">Округ × неделя</h2><Segmented label="Показатель" value={m} onChange={setM} options={[{ value: 'pd', label: 'Посты ПД' }, { value: 'tasks', label: 'План задач' }]} /></div>
      <div className="card-body table-wrap">
        <table className="heatgrid wide">
          <thead><tr><th />{weeks.map((w) => <th key={w}>{fmtDayMonth(w)}</th>)}</tr></thead>
          <tbody>{grid.map((r) => (
            <tr key={r.d.id} className="clickable" onClick={() => go(`/team/districts/${r.d.id}`)}>
              <td className="hg-name ellipsis">{L.dname(r.d.id)}</td>
              {r.vals.map((v, i) => <td key={i}><span className="hg-val" style={{ background: heatBg(v === null ? null : m === 'tasks' ? v / 1.1 : v / max), color: v !== null && (m === 'tasks' ? v / 1.1 : v / max) > 0.55 ? '#fff' : undefined }} title={`${L.dname(r.d.id)}, неделя с ${fmtDayMonth(weeks[i])}: ${r.txt[i]}`}>{r.txt[i]}</span></td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityCalendar({ pd }: { pd: PdData | null }) {
  const asOf = pdAsOf(pd);
  const weeks = weeksBack(12, asOf);
  const byDay = useMemo(() => { const m = new Map<string, number>(); pd?.posts.forEach((p) => m.set(p[0], (m.get(p[0]) ?? 0) + 1)); return m; }, [pd]);
  const max = Math.max(1, ...weeks.flatMap((w) => Array.from({ length: 7 }, (_, k) => byDay.get(addDays(w, k)) ?? 0)));
  const today = asOf;
  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">Календарь активности</h2><span className="small muted">посты ПД, 12 недель по {fmtDayMonth(asOf)}</span></div>
      <div className="card-body">
        <div className="cal-heat">
          <div className="cal-heat-days">{WD_SHORT.map((w) => <span key={w}>{w}</span>)}</div>
          {weeks.map((w) => (
            <div key={w} className="cal-heat-col">
              {Array.from({ length: 7 }, (_, k) => { const d = addDays(w, k); const n = byDay.get(d) ?? 0; return <span key={k} className="cal-heat-cell" style={{ background: d > today ? 'transparent' : heatBg(n ? n / max : 0.0001), outline: d === today ? '2px solid var(--ink)' : undefined }} title={`${fmtDayMonth(d)}: ${n} ${plural(n, ['пост', 'поста', 'постов'])}`} />; })}
            </div>
          ))}
        </div>
        {!pd && <div className="small muted">Загружаю данные «Пиши-Делись»…</div>}
      </div>
    </div>
  );
}

function WeekdayBars({ pd }: { pd: PdData | null }) {
  const from = addDays(pdAsOf(pd), -90);
  const counts = WD_SHORT.map(() => 0);
  pd?.posts.forEach((p) => { if (p[0] >= from) counts[weekday(p[0])]++; });
  const max = Math.max(1, ...counts);
  return (
    <div className="card">
      <div className="card-head"><h2 className="grow">По дням недели</h2><span className="small muted">посты ПД, 90 дней</span></div>
      <div className="card-body">
        <div className="wd-bars">{counts.map((c, i) => <div key={i} className="wd-col" title={`${WD_SHORT[i]}: ${c}`}><span className="wd-val num">{c}</span><span className="wd-track"><span className="daily-bar" style={{ height: `${(c / max) * 100}%` }} /></span><span className="daily-d">{WD_SHORT[i]}</span></div>)}</div>
        <p className="small muted" style={{ marginBottom: 0 }}>В таблице «Пиши-Делись» есть только дата поста, без времени, — поэтому разбивка по дням, а не по часам.</p>
      </div>
    </div>
  );
}

function HeatPeopleWeek({ pd }: { pd: PdData | null }) {
  const s = useAppState();
  const L = useLookup();
  const [okr, setOkr] = useState(s.districts[0]?.id ?? '');
  const weeks = weeksBack(10, pdAsOf(pd));
  const rows = useMemo(() => {
    if (!pd) return [];
    const idx = pd.people.map((p, i) => ({ name: p[0], g: p[1], i })).filter((p) => p.g === okr);
    return idx.map((p) => {
      const c = weeks.map(() => 0);
      pd.posts.forEach((x) => { if (x[4] !== p.i) return; const wi = weeks.indexOf(weekStart(x[0])); if (wi >= 0) c[wi]++; });
      return { name: p.name, c, total: c.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.total - a.total);
  }, [pd, okr, weeks.join()]); // eslint-disable-line
  const max = Math.max(1, ...rows.flatMap((r) => r.c));
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head wrap"><h2 className="grow nowrap">Человек × неделя</h2>
        <select className="select select-sm" style={{ maxWidth: 240 }} value={okr} onChange={(e) => setOkr(e.target.value)} aria-label="Округ">{s.districts.map((d) => <option key={d.id} value={d.id}>{L.dname(d.id)}</option>)}</select>
      </div>
      <div className="card-body table-wrap">
        {!rows.length ? <Empty icon={CheckCircle2} title={pd ? 'В списке округа пока никого нет' : 'Загружаю…'} /> : (
          <table className="heatgrid wide">
            <thead><tr><th />{weeks.map((w) => <th key={w}>{fmtDayMonth(w)}</th>)}<th className="right">Всего</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.name}>
                <td className="hg-name ellipsis">{r.name}</td>
                {r.c.map((v, i) => <td key={i}><span className="hg-val" style={{ background: v ? heatBg(v / max) : '#f6dedb', color: v / max > 0.55 ? '#fff' : undefined }} title={`${r.name}, неделя с ${fmtDayMonth(weeks[i])}: ${v}`}>{v || ''}</span></td>)}
                <td className="right num">{r.total}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>Розовые ячейки — неделя без единого поста: сразу видно, кто выпадает.</p>
      </div>
    </div>
  );
}

/* ───────── Воронка вовлечённости ───────── */
function Funnel({ pd }: { pd: PdData | null }) {
  const s = useAppState();
  const L = useLookup();
  const data = useMemo(() => {
    if (!pd) return null;
    const asOf = pdAsOf(pd);
    const weeks = weeksBack(4, asOf);
    const from12 = addDays(asOf, -84);
    const per = new Map<number, { any12: boolean; weeks: Set<string> }>();
    pd.posts.forEach((p) => {
      const a = per.get(p[4]) ?? { any12: false, weeks: new Set<string>() };
      if (p[0] >= from12) a.any12 = true;
      const w = weekStart(p[0]); if (weeks.includes(w)) a.weeks.add(w);
      per.set(p[4], a);
    });
    const calc = (ids: number[]) => ({
      roster: ids.length,
      wrote: ids.filter((i) => per.get(i)?.any12).length,
      active: ids.filter((i) => (per.get(i)?.weeks.size ?? 0) > 0).length,
      regular: ids.filter((i) => (per.get(i)?.weeks.size ?? 0) >= 4).length,
    });
    const inRoster = (g: string) => pd.people.map((p, i) => ({ g: p[1], i })).filter((p) => p.g === g).map((p) => p.i);
    const okr = s.districts.map((d) => ({ d, ...calc(inRoster(d.id)) }));
    const all = okr.reduce((t, x) => ({ roster: t.roster + x.roster, wrote: t.wrote + x.wrote, active: t.active + x.active, regular: t.regular + x.regular }), { roster: 0, wrote: 0, active: 0, regular: 0 });
    return { okr, all };
  }, [pd, s.districts]);
  if (!data) return null;
  const steps: [keyof typeof data.all, string][] = [['roster', 'В списке округов'], ['wrote', 'Писали хоть раз за 12 недель'], ['active', 'Активны за последние 4 недели'], ['regular', 'Пишут каждую неделю']];
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head"><h2 className="grow">Воронка вовлечённости</h2><span className="small muted">«Пиши-Делись» по {fmtDayMonth(pdAsOf(pd))}, люди из списка по округам</span></div>
      <div className="card-body">
        <div className="funnel">
          {steps.map(([k, label]) => { const v = data.all[k]; const share = data.all.roster ? v / data.all.roster : 0; return (
            <div key={k} className="fn-step"><div className="fn-bar" style={{ width: `${Math.max(share * 100, 3)}%` }}><b>{v}</b></div><span>{label}{k !== 'roster' && <span className="muted"> · {pct(share)}</span>}</span></div>
          ); })}
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="tbl heat">
            <thead><tr><th>Округ</th><th className="right">В списке</th><th className="right">Писали</th><th className="right">Активны</th><th className="right">Регулярно</th><th className="right">Доля регулярных</th></tr></thead>
            <tbody>{data.okr.map((x) => (
              <tr key={x.d.id} className="clickable" onClick={() => go(`/team/districts/${x.d.id}`)}>
                <td className="t-title nowrap">{L.dname(x.d.id)}</td><td className="right">{x.roster}</td><td className="right">{x.wrote}</td><td className="right">{x.active}</td><td className="right">{x.regular}</td>
                <td className="hc" style={{ background: heatBg(x.roster ? x.regular / x.roster / 0.6 : null) }}>{x.roster ? pct(x.regular / x.roster) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

