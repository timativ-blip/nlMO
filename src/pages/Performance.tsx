import { ArrowRight, Info } from "lucide-react";
import { useAppState } from "../data/store";
import { coordinatorPerformance } from "../data/performance";
import { roleLabel } from "../data/types";
import { todayISO } from "../lib/date";
import { go } from "../lib/router";
import { openRecords } from "../ui/global";
import { useMe, usePeriod } from "../ui/hooks";
import { Avatar, Button } from "../ui/kit";
import { ContextBar, useScopeDistrict } from "../ui/widgets";
const percent = (n: number | null) =>
  n === null ? "—" : Math.round(n * 100) + "%";
export default function PerformancePage() {
  const s = useAppState(),
    me = useMe(),
    period = usePeriod(),
    scope = useScopeDistrict();
  const people = s.users.filter(
    (u) =>
      u.role === "coordinator" &&
      u.active &&
      !u.pending &&
      (!scope || scope === "all" || u.districtId === scope) &&
      (me.role !== "coordinator" || u.districtId === me.districtId),
  );
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Успеваемость координаторов</h1>
          <p className="sub">
            Результаты округа, соблюдение сроков и дисциплина отчётности.
          </p>
        </div>
        <ContextBar />
      </div>
      <div className="callout info">
        <Info size={18} />
        <span>
          Оценка работы округа: 60% — подтверждённые задачи из назначенных на
          период, 40% — своевременная сдача результатов. Оценка появляется от 3
          задач. Отчёты показаны отдельно: завершённые будни, без учёта отпусков
          и праздников. Данные, к которым нет доступа, отмечены прочерком.
        </span>
      </div>
      <div className="performance-list">
        {people.map((person) => {
          const r = coordinatorPerformance(
            s,
            me,
            person,
            period.from,
            period.to,
            todayISO(),
          );
          return (
            <article key={person.id} className="card performance-card">
              <div className="performance-person">
                <Avatar user={person} size={42} />
                <div className="grow">
                  <h2>{person.name}</h2>
                  <p className="small muted">
                    {roleLabel(person)} · {person.districtId} округ
                  </p>
                </div>
                <strong className="performance-score">
                  {r.score === null ? "—" : r.score}
                  <small>{r.score === null ? "Мало данных" : "из 100"}</small>
                </strong>
              </div>
              <div className="performance-measures">
                <button
                  onClick={() =>
                    openRecords({
                      title: "Задачи округа на период",
                      tasks: r.tasks,
                    })
                  }
                >
                  <span>Выполнено</span>
                  <b>
                    {r.done.length} / {r.tasks.length}
                  </b>
                  <progress max={1} value={r.completion ?? 0} />
                </button>
                <button
                  onClick={() =>
                    openRecords({
                      title: "Сданные вовремя результаты",
                      tasks: r.onTime,
                    })
                  }
                >
                  <span>Сдано вовремя</span>
                  <b>{percent(r.timeliness)}</b>
                  <small>
                    {r.onTime.length} из {r.submitted.length} сданных
                  </small>
                </button>
                <button disabled={!r.dailyVisible} onClick={() => go("/daily")}>
                  <span>Отчёты дня</span>
                  <b>
                    {r.dailyVisible
                      ? `${r.reported.length} / ${r.days.length}`
                      : "—"}
                  </b>
                  <small>
                    {r.dailyVisible
                      ? "за завершённые будни"
                      : "Нет доступа к отчётам"}
                  </small>
                </button>
              </div>
              <div className="row">
                <span className="small muted grow">
                  {r.tasks.length < 3
                    ? "Для устойчивой оценки нужно хотя бы 3 задачи."
                    : "Нажмите на показатель, чтобы проверить записи."}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={ArrowRight}
                  onClick={() => go("/team/districts/" + person.districtId)}
                >
                  Округ
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {!people.length && (
        <section className="card hq-quiet">
          <h2>Пока нет учётных записей координаторов</h2>
          <p className="muted">
            После регистрации и подтверждения доступа здесь появятся результаты
            работы. Имена из таблицы сами по себе не создают учётные записи.
          </p>
          <Button onClick={() => go("/team/districts")}>Открыть округа</Button>
        </section>
      )}
    </>
  );
}
