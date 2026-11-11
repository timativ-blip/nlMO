import type { State, User } from "./types";
import { canSeeDaily, canSeeTask } from "./perm";
import { addDays, inRange, weekday } from "../lib/date";
/** Factual period counters. Missing/hidden data is never converted to a zero score. */
export function coordinatorPerformance(
  s: State,
  viewer: User,
  person: User,
  from: string,
  to: string,
  today: string,
) {
  const end = to < today ? to : addDays(today, -1);
  const tasks = s.tasks.filter(
    (t) =>
      canSeeTask(viewer, t) &&
      t.status !== "cancelled" &&
      t.districtId === person.districtId &&
      inRange(t.due, from, end),
  );
  const done = tasks.filter((t) => t.status === "done"),
    submitted = tasks.filter(
      (t) => !!t.result && ["review", "done"].includes(t.status),
    );
  const onTime = submitted.filter(
    (t) => !!t.result?.submittedDate && t.result.submittedDate <= t.due,
  );
  const past = to < today ? to : addDays(today, -1),
    days: string[] = [];
  for (let day = from; day <= past; day = addDays(day, 1))
    if (weekday(day) < 5) days.push(day);
  const dailyVisible = canSeeDaily(viewer, person),
    reported = days.filter((day) =>
      s.dailyReports.some((r) => r.userId === person.id && r.day === day),
    );
  const completion = tasks.length ? done.length / tasks.length : null,
    timeliness = submitted.length ? onTime.length / submitted.length : null;
  // Task evidence remains a separate result; reporting discipline is not a substitute for outcomes.
  const score =
    tasks.length >= 3
      ? Math.round(100 * (completion! * 0.6 + (timeliness ?? 0) * 0.4))
      : null;
  return {
    tasks,
    done,
    submitted,
    onTime,
    days,
    reported,
    dailyVisible,
    completion,
    timeliness,
    score,
  };
}
