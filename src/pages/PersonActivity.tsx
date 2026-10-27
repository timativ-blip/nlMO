// Активность человека за неделю и месяц в одном месте: задачи, «Пиши-Делись», отчёты дня, рейтинг.
// Отвечает на главный вопрос руководителя: работает ли человек.
import { Activity } from 'lucide-react';
import { useMemo } from 'react';
import { isOverdue, rateUsers } from '../data/calc';
import * as P from '../data/perm';
import { useAppState } from '../data/store';
import type { User } from '../data/types';
import { addDays, fmtDayMonth, monthEnd, monthStart, todayISO, weekday, weekStart } from '../lib/date';
import { nameKey } from '../lib/names';
import { useJson, type PdData } from './Media';

interface Range { from: string; to: string }
const workdaysIn = (r: Range) => { const out: string[] = []; for (let d = r.from; d <= r.to; d = addDays(d, 1)) if (weekday(d) < 5) out.push(d); return out; };

export default function PersonActivity({ u }: { u: User }) {
  const s = useAppState();
  const pd = useJson<PdData>('media-pd', 5 * 60000);
  const today = todayISO();
  const week = { from: weekStart(today), to: today };
  const prevWeek = { from: addDays(week.from, -7), to: addDays(week.from, -1) };
  const month = { from: monthStart(today), to: today };
  const pm = monthStart(addDays(month.from, -1));
  const prevMonth = { from: pm, to: monthEnd(pm) };

  const pdIndex = useMemo(() => (pd.data ? pd.data.people.findIndex((p) => nameKey(p[0]) === nameKey(u.name)) : -1), [pd.data, u.name]);
  const pdAsOf = pd.data?.posts.reduce((m, p) => (p[0] > m ? p[0] : m), '') ?? '';
  const daily = P.mustReportDaily(u);

  const calc = (r: Range) => {
    const mine = s.tasks.filter((t) => t.assigneeId === u.id || t.coAssigneeIds.includes(u.id));
    const done = mine.filter((t) => t.status === 'done' && (t.confirmedAt ?? '') >= r.from && (t.confirmedAt ?? '') <= r.to);
    const submitted = mine.filter((t) => t.result && t.result.submittedDate >= r.from && t.result.submittedDate <= r.to).length;
    const posts = pd.data && pdIndex >= 0 ? pd.data.posts.filter((p) => p[4] === pdIndex && p[0] >= r.from && p[0] <= r.to) : [];
    const wd = workdaysIn(r).filter((d) => d <= today);
    const reports = s.dailyReports.filter((x) => x.userId === u.id && x.day >= r.from && x.day <= r.to).length;
    return { done: done.length, submitted, posts: posts.length, pts: posts.reduce((a, p) => a + (p[5] as number), 0), reports, wd: wd.length };
  };
  const W = calc(week), PW = calc(prevWeek), M = calc(month), PM = calc(prevMonth);
  const overdue = s.tasks.filter((t) => (t.assigneeId === u.id || t.coAssigneeIds.includes(u.id)) && isOverdue(t)).length;
  const rank = useMemo(() => {
    const peers = s.users.filter((x) => x.active && x.role === u.role && (u.role !== 'member' || x.districtId === u.districtId));
    const r = rateUsers(s, peers, month.from, month.to).filter((x) => x.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const i = r.findIndex((x) => x.user.id === u.id);
    return i >= 0 ? { place: i + 1, of: r.length } : null;
  }, [s, u, month.from, month.to]);

  // итог: есть ли хоть какая-то активность за неделю
  const any = W.done + W.submitted + W.posts + W.reports;
  const verdict = any === 0 ? { cls: 'danger', text: 'За эту неделю активности нет' } : (daily && W.reports < Math.min(W.wd, 3)) || overdue > 2 ? { cls: 'warn', text: 'Работает, но есть пробелы' } : { cls: 'ok', text: 'Активно работает' };

  const cmp = (a: number, b: number) => (b === 0 && a === 0 ? null : <span className={`small ${a >= b ? 'delta-up' : 'delta-down'}`}>{a >= b ? '↑' : '↓'} было {b}</span>);
  const Row = ({ label, w, pw, m, pmv, hint }: { label: string; w: string | number; pw: number; m: string | number; pmv: number; hint?: string }) => (
    <tr><td><b>{label}</b>{hint && <div className="small muted">{hint}</div>}</td><td className="right"><b className="num">{w}</b> {cmp(+String(w).split(' ')[0], pw)}</td><td className="right"><b className="num">{m}</b> {cmp(+String(m).split(' ')[0], pmv)}</td></tr>
  );
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head wrap"><Activity size={17} /><h2 className="grow">Активность</h2><span className={`callout ${verdict.cls}`} style={{ padding: '4px 10px' }}>{verdict.text}</span></div>
      <div className="card-body table-wrap">
        <table className="tbl act-tbl">
          <thead><tr><th /><th className="right">Эта неделя<div className="small muted" style={{ fontWeight: 400 }}>с {fmtDayMonth(week.from)}</div></th><th className="right">Этот месяц<div className="small muted" style={{ fontWeight: 400 }}>с {fmtDayMonth(month.from)}</div></th></tr></thead>
          <tbody>
            <Row label="Задачи подтверждены" w={W.done} pw={PW.done} m={M.done} pmv={PM.done} />
            <Row label="Результаты сданы на проверку" w={W.submitted} pw={PW.submitted} m={M.submitted} pmv={PM.submitted} />
            {pdIndex >= 0
              ? <Row label="Посты «Пиши-Делись»" hint={pdAsOf && pdAsOf < addDays(today, -2) ? `таблица обновлена по ${fmtDayMonth(pdAsOf)}` : `баллы: неделя ${Math.round(W.pts)}, месяц ${Math.round(M.pts)}`} w={W.posts} pw={PW.posts} m={M.posts} pmv={PM.posts} />
              : <tr><td><b>Посты «Пиши-Делись»</b></td><td colSpan={2} className="right small muted">{pd.data ? 'нет в списках «Пиши-Делись» (сверяем по фамилии и имени)' : 'загружаю…'}</td></tr>}
            {daily && <Row label="Отчёты дня" hint="сдано из рабочих дней" w={`${W.reports} из ${W.wd}`} pw={PW.reports} m={`${M.reports} из ${M.wd}`} pmv={PM.reports} />}
            <tr><td><b>Просрочено сейчас</b></td><td colSpan={2} className="right"><b className="num" style={{ color: overdue ? 'var(--c-danger)' : undefined }}>{overdue}</b></td></tr>
            <tr><td><b>Место в рейтинге за месяц</b><div className="small muted">{u.role === 'member' ? 'среди участников округа' : 'среди коллег с той же ролью'}</div></td><td colSpan={2} className="right">{rank ? <b className="num">{rank.place} из {rank.of}</b> : <span className="small muted">недостаточно задач для оценки</span>}</td></tr>
          </tbody>
        </table>
        <p className="small muted" style={{ marginBottom: 0 }}>Рядом с цифрой — сколько было за прошлую неделю и прошлый месяц целиком.</p>
      </div>
    </div>
  );
}
