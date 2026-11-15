import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  ArrowUpRight,
  BarChart3,
  ListChecks,
  Target,
} from "lucide-react";
import { useMemo } from "react";
import { isOverdue } from "../data/calc";
import { periodTrend, taskSnapshot } from "../data/insights";
import * as P from "../data/perm";
import { useAppState } from "../data/store";
import { useCommunications } from "../data/communications";
import { fmtDayLong, fmtRange, inRange, todayISO } from "../lib/date";
import { firstName } from "../lib/names";
import { meetingWhen, meetingPhase } from "../lib/meeting-time";
import { go } from "../lib/router";
import { useMe, usePeriod } from "../ui/hooks";
import { openRecords } from "../ui/global";
import { ComparisonColumns } from "../ui/DashboardVisuals";
import { ProgressRing } from "../ui/charts";
import { Button } from "../ui/kit";
import { ContextBar, TaskRow } from "../ui/widgets";
export default function Home() {
  const s = useAppState(),
    me = useMe(),
    comm = useCommunications(),
    today = todayISO(),
    period = usePeriod();
  const now = Date.now() + comm.clockOffset;
  const visible = useMemo(() => s.tasks.filter((t) => P.canSeeTask(me, t)), [s.tasks, me]),
    overdue = visible.filter((t) => isOverdue(t)),
    review = visible.filter((t) => P.canReview(me, t));
  const due = visible.filter(
      (t) => ["new", "in_progress"].includes(t.status) && t.due === today,
    ),
    missing =
      P.mustReportDaily(me) &&
      !s.dailyReports.some((r) => r.userId === me.id && r.day === today);
  const focus = [...review, ...overdue, ...due]
    .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
    .slice(0, 5);
  const next = comm.meetings
    .filter((m) => ["live", "scheduled"].includes(meetingPhase(m, now)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const snapshot = taskSnapshot(visible, period.from, period.to);
  const cohort = snapshot.flatMap(group => group.tasks);
  const completed = snapshot.find(group => group.id === 'done')!.tasks;
  const trend = useMemo(() => periodTrend(visible, period.from, period.to), [visible, period.from, period.to]);
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Добрый день, {firstName(me.name)}</h1>
          <p className="sub">{fmtDayLong(today)} · рабочий кабинет штаба</p>
        </div>
        <ContextBar showDistrict={false}/>
      </div>
      <div className="dashboard-grid home-dashboard">
        <section className="card dashboard-card dashboard-completion">
          <div className="dashboard-card-head"><span className="dashboard-icon"><Target size={17}/></span><h2>Выполнение задач</h2><button type="button" className="dashboard-detail" onClick={() => openRecords({title:'Задачи выбранного периода',tasks:cohort,rule:'Задачи со сроком в выбранном периоде. Отменённые задачи исключены. Выполнены только подтверждённые результаты.'})} aria-label="Открыть задачи выбранного периода"><ArrowUpRight size={17}/></button></div>
          <ProgressRing value={cohort.length ? completed.length / cohort.length : null} label="выполнено"/>
          <p className="dashboard-caption">{cohort.length ? `${completed.length} из ${cohort.length} задач подтверждено` : 'За выбранный период задач пока нет'}</p>
          <span className="dashboard-period">{period.label}</span>
        </section>
        <section className="card dashboard-card dashboard-queue" aria-label="Кратко на сегодня">
          <div className="dashboard-card-head"><span className="dashboard-icon"><ListChecks size={17}/></span><h2>Очередь работы</h2></div>
          <p className="dashboard-caption">На сегодня · независимо от периода</p>
          <div className="hq-home-counters">
          {[
            { n: due.length, label: "На сегодня", path: "/tasks?due=today" },
            {
              n: overdue.length,
              label: "Просрочено",
              path: "/tasks?overdue=1",
            },
            {
              n: review.length,
              label: "Проверить",
              path: "/tasks?status=review",
            },
          ].map((x) => (
            <button key={x.label} onClick={() => go(x.path)} className={x.label === 'Просрочено' && x.n ? 'counter-alert' : ''}>
              <b>{x.n}</b>
              <span>{x.label}</span>
              <ArrowUpRight size={14} aria-hidden/>
            </button>
          ))}
          </div>
        </section>
        <section className="card dashboard-card dashboard-tempo">
          <div className="dashboard-card-head"><span className="dashboard-icon"><BarChart3 size={17}/></span><h2>Динамика результатов</h2></div>
          <p className="dashboard-caption">{fmtRange(period.from, period.to)}</p>
          <ComparisonColumns data={trend} onPick={(point, series) => openRecords({title:`${series === 'assigned' ? 'Задачи по сроку' : 'Подтверждённые результаты'}: ${fmtRange(point.from, point.to)}`,tasks:series === 'confirmed' ? point.tasks : visible.filter(t => t.status !== 'cancelled' && inRange(t.due, point.from, point.to)),rule:series === 'confirmed' ? 'По дате подтверждения результата.' : 'По сроку задачи. Отменённые задачи исключены.'})}/>
        </section>
      </div>
      <div className="hq-home-columns">
        <section className="card">
          <div className="card-head">
            <h2 className="grow">Требует внимания</h2>
            <Button
              size="sm"
              variant="ghost"
              icon={ArrowRight}
              onClick={() => go("/tasks")}
            >
              Все задачи
            </Button>
          </div>
          {focus.map((t) => (
            <TaskRow t={t} key={t.id} />
          ))}
          {!focus.length && (
            <div className="hq-quiet">
              <CheckCircle2 size={24} />
              <p>На сегодня всё под контролем.</p>
              <Button size="sm" onClick={() => go("/performance")}>
                Посмотреть показатели
              </Button>
            </div>
          )}
        </section>
        <div className="col" style={{ gap: 16 }}>
          <section className="card hq-next">
            <span className="hq-section-label">
              <CalendarDays size={16} />
              Ближайшая встреча
            </span>
            {next ? (
              <>
                <h2>{next.title}</h2>
                <p className="muted">
                  {meetingPhase(next, now) === "live"
                    ? "Уже идёт"
                    : meetingWhen(next.startsAt)}
                </p>
                <Button onClick={() => go("/meetings/" + next.id)}>
                  Открыть встречу
                </Button>
              </>
            ) : (
              <>
                <p className="muted">В расписании пока нет встреч.</p>
                <Button size="sm" onClick={() => go("/meetings")}>
                  Запланировать
                </Button>
              </>
            )}
          </section>
          <section className="card hq-next">
            <span className="hq-section-label">
              <FileText size={16} />
              Отчёт дня
            </span>
            <p>
              {missing
                ? "Осталось записать итоги дня."
                : P.mustReportDaily(me)
                  ? "Сегодняшний отчёт сохранён."
                  : "Отчёты команды и итоги работы."}
            </p>
            <Button
              size="sm"
              icon={missing ? Clock : ArrowRight}
              onClick={() => go("/daily")}
            >
              {missing ? "Заполнить отчёт" : "Открыть отчёты"}
            </Button>
          </section>
        </div>
      </div>
    </>
  );
}
