import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
} from "lucide-react";
import { isOverdue } from "../data/calc";
import * as P from "../data/perm";
import { useAppState } from "../data/store";
import { useCommunications } from "../data/communications";
import { fmtDayLong, todayISO } from "../lib/date";
import { firstName } from "../lib/names";
import { meetingWhen, meetingPhase } from "../lib/meeting-time";
import { go } from "../lib/router";
import { useMe } from "../ui/hooks";
import { Button } from "../ui/kit";
import { TaskRow } from "../ui/widgets";
export default function Home() {
  const s = useAppState(),
    me = useMe(),
    comm = useCommunications(),
    today = todayISO();
  const now = Date.now() + comm.clockOffset;
  const visible = s.tasks.filter((t) => P.canSeeTask(me, t)),
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
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Добрый день, {firstName(me.name)}</h1>
          <p className="sub">{fmtDayLong(today)} · рабочий кабинет штаба</p>
        </div>
      </div>
      <section className="hq-home-strip" aria-label="Кратко на сегодня">
        <div className="hq-home-glow" aria-hidden />
        <div className="hq-home-strip-title">
          <span>Сегодня в работе</span>
          <h2>
            {focus.length
              ? "Сначала — главное"
              : "Можно сосредоточиться на работе"}
          </h2>
          <p>
            {focus.length
              ? "Сроки, проверки и ближайшие встречи."
              : "Срочных задач и результатов на проверке нет."}
          </p>
        </div>
        <div className="hq-home-counters">
          {[
            { n: due.length, label: "На сегодня", path: "/tasks" },
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
            <button key={x.label} onClick={() => go(x.path)}>
              <b>{x.n}</b>
              <span>{x.label}</span>
            </button>
          ))}
        </div>
      </section>
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
