import { addDays, diffDays, inRange, todayISO, weekStart } from '../lib/date';
import { canSeeTask } from './perm';
import type { State, Task, User } from './types';

const mskDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
export function dateInMoscow(value?: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value ? value : null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : mskDay.format(new Date(time));
}

/** New analysis uses the same role restrictions in demo and production. */
export function analyticsTasks(s: State, viewer: User, districtId?: string | null) {
  return s.tasks.filter((task) => canSeeTask(viewer, task) && (!districtId || districtId === 'all' || task.districtId === districtId));
}

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;
  return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null;
}

export interface TrendBin { from: string; to: string; assigned: number; confirmed: number; tasks: Task[] }
export function periodTrend(tasks: Task[], from: string, to: string): TrendBin[] {
  const days = diffDays(to, from) + 1;
  const step = days > 16 ? 7 : 1;
  const bins: TrendBin[] = [];
  for (let start = from; start <= to; start = addDays(start, step)) {
    const end = addDays(start, step - 1) < to ? addDays(start, step - 1) : to;
    const confirmed = tasks.filter((t) => t.status === 'done' && inRange(t.confirmedAt, start, end));
    bins.push({ from: start, to: end, assigned: tasks.filter((t) => t.status !== 'cancelled' && inRange(t.due, start, end)).length, confirmed: confirmed.length, tasks: confirmed });
  }
  return bins;
}

export const STATUS_COLORS = { new: 'var(--chart-new)', in_progress: 'var(--chart-work)', review: 'var(--chart-review)', done: 'var(--chart-done)' };
export function taskSnapshot(tasks: Task[], from: string, to: string) {
  const cohort = tasks.filter((t) => t.status !== 'cancelled' && inRange(t.due, from, to));
  return (['new', 'in_progress', 'review', 'done'] as const).map((status) => ({ id: status, tasks: cohort.filter((t) => t.status === status) }));
}

export function processInsights(tasks: Task[], users: User[], from: string, to: string, today = todayISO()) {
  const active = tasks.filter((t) => t.status === 'new' || t.status === 'in_progress');
  const overdue = active.filter((t) => t.due < today);
  const review = tasks.filter((t) => t.status === 'review');
  const waiting = review.flatMap((task) => {
    const submitted = dateInMoscow(task.result?.submittedDate || task.result?.submittedAt);
    return submitted && submitted <= today ? [{ task, days: diffDays(today, submitted) }] : [];
  }).sort((a, b) => b.days - a.days);
  const confirmed = tasks.filter((t) => t.status === 'done' && inRange(t.confirmedAt, from, to));
  const cycles = confirmed.flatMap((task) => {
    const created = dateInMoscow(task.createdAt), ended = dateInMoscow(task.confirmedAt);
    return created && ended && ended >= created ? [{ task, days: diffDays(ended, created) }] : [];
  });
  const returned = confirmed.filter((t) => !!t.returnedAt || t.comments.some((c) => c.kind === 'return'));
  const aging = [{ id: '1-3', label: '1–3 дня', min: 1, max: 3 }, { id: '4-7', label: '4–7 дней', min: 4, max: 7 }, { id: '8-14', label: '8–14 дней', min: 8, max: 14 }, { id: '15+', label: '15+ дней', min: 15, max: Infinity }].map((bucket) => ({
    ...bucket, tasks: overdue.filter((t) => { const days = diffDays(today, t.due); return days >= bucket.min && days <= bucket.max; }),
  }));
  const upcoming = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i);
    return { day, tasks: active.filter((t) => t.due === day) };
  });
  // Count each assignment once per person, including co-assignees.
  const workloads = users.filter((u) => u.active).map((user) => {
    const assigned = tasks.filter((t) => t.assigneeId === user.id || t.coAssigneeIds.includes(user.id));
    return { user, active: assigned.filter((t) => t.status === 'new' || t.status === 'in_progress' || t.status === 'review'),
      overdue: assigned.filter((t) => (t.status === 'new' || t.status === 'in_progress') && t.due < today), review: assigned.filter((t) => t.status === 'review') };
  }).filter((r) => r.active.length).sort((a, b) => b.active.length - a.active.length || a.user.name.localeCompare(b.user.name, 'ru'));
  // Twelve complete calendar columns, ending this Sunday. Future dates stay empty.
  const heatStart = addDays(weekStart(today), -77);
  const heat = Array.from({ length: 84 }, (_, i) => {
    const day = addDays(heatStart, i);
    return { day, future: day > today, tasks: tasks.filter((t) => t.status === 'done' && t.confirmedAt === day && day <= today) };
  });
  return { overdue, review, waiting, confirmed, cycles, cycleMedian: median(cycles.map((c) => c.days)), reviewMedian: median(waiting.map((c) => c.days)),
    returned, returnShare: confirmed.length ? returned.length / confirmed.length : null, aging, upcoming, workloads, heat };
}
