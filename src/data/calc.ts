// Все сводные цифры рассчитываются только здесь — из задач, мероприятий и показателей.
// Каждая функция возвращает вместе с числом записи-источники, чтобы цифру можно было «раскрыть».
import { addDays, diffDays, inRange, todayISO, weekStart } from '../lib/date';
import type { Metric, State, Task, User } from './types';

export const ACTIVE = (t: Task) => t.status === 'new' || t.status === 'in_progress' || t.status === 'review';
export const isOverdue = (t: Task, today = todayISO()) => (t.status === 'new' || t.status === 'in_progress') && t.due < today;
export const isOnTime = (t: Task) => !!t.result && t.result.submittedDate <= t.due;
export const confirmedIn = (t: Task, from: string, to: string) => t.status === 'done' && inRange(t.confirmedAt, from, to);

export interface Scope { districtId?: string | null; userId?: string }
const inScope = (t: Task, sc: Scope) =>
  (!sc.districtId || sc.districtId === 'all' || t.districtId === sc.districtId) &&
  (!sc.userId || t.assigneeId === sc.userId || t.coAssigneeIds.includes(sc.userId));

/** Задачи, назначенные на период: срок попадает в период, не отменены. */
export const assignedIn = (s: State, from: string, to: string, sc: Scope = {}) =>
  s.tasks.filter((t) => t.status !== 'cancelled' && inRange(t.due, from, to) && inScope(t, sc));

/** Для оценки: только задачи, срок которых уже наступил, плюс выполненные досрочно — чтобы периоды были сопоставимы. */
const dueSoFar = (s: State, from: string, to: string, sc: Scope) => {
  const today = todayISO();
  return assignedIn(s, from, to, sc).filter((t) => t.due < today || t.status === 'done');
};

export interface MetricFact { metric: Metric; plan: number; fact: number; pct: number; records: Task[] }

/**
 * План масштабируется на длину периода: месячный план × дней / 30.
 * Для текущего периода на дашбордах (prorate) берутся только прошедшие дни, чтобы темп был сопоставим;
 * в отчёте — полный план недели.
 */
/** Месячный план показателя для округа: свой, если задан руководством, иначе общий */
export const districtMonthlyPlan = (m: Metric, districtId: string) => m.districtPlans?.[districtId] ?? m.monthlyPlan;

export function metricFacts(s: State, from: string, to: string, districtId?: string | null, prorate = true): MetricFact[] {
  const today = todayISO();
  const days = Math.max(1, diffDays(prorate && to > today ? today : to, from) + 1);
  return s.metrics.map((m) => {
    const records = s.tasks.filter((t) => t.metricId === m.id && confirmedIn(t, from, to) && inScope(t, { districtId }));
    const fact = records.reduce((a, t) => a + (t.result?.value ?? 0), 0);
    const monthly = !districtId || districtId === 'all' ? s.districts.reduce((a, d) => a + districtMonthlyPlan(m, d.id), 0) : districtMonthlyPlan(m, districtId);
    const plan = Math.max(1, Math.round((monthly * days) / 30));
    return { metric: m, plan, fact, pct: fact / plan, records };
  });
}

/** Выполнение плана — взвешенное среднее по показателям, каждый ограничен 120 %. */
export function planFulfillment(facts: MetricFact[]) {
  const wsum = facts.reduce((a, f) => a + f.metric.weight, 0);
  if (!wsum) return 0;
  return facts.reduce((a, f) => a + Math.min(f.pct, 1.2) * f.metric.weight, 0) / wsum;
}

export interface Kpis {
  plan: number;
  facts: MetricFact[];
  confirmed: Task[];
  assigned: Task[];
  onTimeShare: number | null;
  onTimeRecords: Task[];
  overdue: Task[];
  review: Task[];
}
export function kpis(s: State, from: string, to: string, districtId?: string | null): Kpis {
  const facts = metricFacts(s, from, to, districtId);
  const confirmed = s.tasks.filter((t) => confirmedIn(t, from, to) && inScope(t, { districtId }));
  const onTimeRecords = confirmed.filter(isOnTime);
  return {
    plan: planFulfillment(facts),
    facts,
    confirmed,
    assigned: assignedIn(s, from, to, { districtId }),
    onTimeShare: confirmed.length ? onTimeRecords.length / confirmed.length : null,
    onTimeRecords,
    overdue: s.tasks.filter((t) => isOverdue(t) && inScope(t, { districtId })),
    review: s.tasks.filter((t) => t.status === 'review' && inScope(t, { districtId })),
  };
}

export interface TrendPoint { from: string; to: string; confirmed: number; assigned: number; plan: number }
export function weeklyTrend(s: State, weeks: number, districtId?: string | null): TrendPoint[] {
  const cur = weekStart(todayISO());
  const out: TrendPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = addDays(cur, -7 * i), to = addDays(from, 6);
    const k = kpis(s, from, to, districtId);
    out.push({ from, to, confirmed: k.confirmed.length, assigned: k.assigned.length, plan: k.plan });
  }
  return out;
}

/* ───────── Рейтинг ───────── */
export interface Contribution { task: Task; points: number; onTime: boolean }
export interface PersonScore {
  user: User;
  assigned: Task[];
  done: Task[];
  completion: number;
  onTime: number;
  points: number;
  volume: number;
  score: number | null; // null → «Недостаточно данных»
  contributions: Contribution[];
}

export function taskPoints(s: State, t: Task) {
  const base = s.weights.priority[t.priority];
  return isOnTime(t) ? base : base * s.weights.lateFactor;
}

/**
 * Оценка сотрудника за период (0–100):
 *   выполнение = подтверждённые / назначенные на период (по сроку);
 *   вовремя    = доля результатов, сданных не позже срока;
 *   объём      = баллы подтверждённых задач (вес приоритета × штраф за опоздание) / максимум среди сравниваемых.
 * Созданные пользователем задачи в оценку не входят — только назначенные ему.
 */
export function rateUsers(s: State, users: User[], from: string, to: string): PersonScore[] {
  const w = s.weights;
  const rows = users.map((user) => {
    const assigned = dueSoFar(s, from, to, { userId: user.id });
    const done = assigned.filter((t) => t.status === 'done');
    const contributions = done.map((task) => ({ task, points: taskPoints(s, task), onTime: isOnTime(task) }));
    const points = contributions.reduce((a, c) => a + c.points, 0);
    return { user, assigned, done, contributions, points, completion: assigned.length ? done.length / assigned.length : 0, onTime: done.length ? done.filter(isOnTime).length / done.length : 0, volume: 0, score: null as number | null };
  });
  const maxPts = Math.max(1, ...rows.map((r) => r.points));
  const wsum = w.personCompletion + w.personOnTime + w.personVolume || 1;
  rows.forEach((r) => {
    r.volume = r.points / maxPts;
    r.score = r.assigned.length < w.minTasks ? null : (100 * (w.personCompletion * r.completion + w.personOnTime * r.onTime + w.personVolume * r.volume)) / wsum;
  });
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

export interface DistrictScore {
  districtId: string;
  name: string;
  plan: number;
  completion: number;
  onTime: number;
  assigned: Task[];
  done: Task[];
  facts: MetricFact[];
  score: number | null;
}
export function rateDistricts(s: State, from: string, to: string): DistrictScore[] {
  const w = s.weights;
  const wsum = w.districtPlan + w.districtCompletion + w.districtOnTime || 1;
  return s.districts
    .map((d) => {
      const assigned = dueSoFar(s, from, to, { districtId: d.id });
      const done = assigned.filter((t) => t.status === 'done');
      const facts = metricFacts(s, from, to, d.id);
      const plan = planFulfillment(facts);
      const completion = assigned.length ? done.length / assigned.length : 0;
      const onTime = done.length ? done.filter(isOnTime).length / done.length : 0;
      const score = assigned.length < w.minTasks ? null : (100 * (w.districtPlan * Math.min(plan, 1) + w.districtCompletion * completion + w.districtOnTime * onTime)) / wsum;
      return { districtId: d.id, name: d.name, plan, completion, onTime, assigned, done, facts, score };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/* ───────── Отчёт ───────── */
export function reportData(s: State, districtId: string, ws: string) {
  const to = addDays(ws, 6);
  return {
    from: ws,
    to,
    tasks: s.tasks.filter((t) => t.districtId === districtId && confirmedIn(t, ws, to)),
    events: s.events.filter((e) => e.districtId === districtId && !e.cancelled && inRange(e.start, ws, to)),
    facts: metricFacts(s, ws, to, districtId, false),
    overdue: s.tasks.filter((t) => t.districtId === districtId && isOverdue(t)),
  };
}

export const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
export const num = (x: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(x);
