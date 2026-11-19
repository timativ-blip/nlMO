import { ArrowRight, Info } from "lucide-react";
import { useAppState } from "../data/store";
import { coordinatorPerformance } from "../data/performance";
import { roleLabel } from "../data/types";
import { todayISO } from "../lib/date";
import { go } from "../lib/router";
import { openRecords } from "../ui/global";
import { dailyCoverage, taskShare } from "../ui/metricSources";
import { useMe, usePeriod } from "../ui/hooks";
import { Avatar, Button } from "../ui/kit";
import { ProgressRing } from "../ui/charts";
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
                <div className="performance-score"><ProgressRing value={r.score === null ? null : r.score / 100} suffix="" label={r.score === null ? "мало данных" : "из 100"} onPick={() => openRecords({title:`Оценка: ${person.name}`,rule:'60% выполнение задач, 40% своевременность сдачи. Оценка доступна от трёх задач.',sections:[
                  ...taskShare('Выполнение',r.tasks,r.done,'').sections!.map((section,i)=>({...section,title:i===0?'Выполнено':'Остальные задачи'})),
                  ...taskShare('Сроки',r.submitted,r.onTime,'').sections!.map((section,i)=>({...section,title:i===0?'Сдано вовремя':'Сдано с опозданием или без даты'})),
                ]})}/></div>
              </div>
              <div className="performance-measures">
                <button
                  onClick={() =>
                    openRecords(taskShare("Задачи округа на период",r.tasks,r.done,"Подтверждённые задачи из назначенных на завершившиеся дни выбранного периода."))
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
                    openRecords(taskShare("Сроки сдачи результатов",r.submitted,r.onTime,"Среди задач с результатом в статусе «На проверке» или «Выполнена»."))
                  }
                >
                  <span>Сдано вовремя</span>
                  <b>{percent(r.timeliness)}</b>
                  <small>
                    {r.onTime.length} из {r.submitted.length} сданных
                  </small>
                </button>
                <button disabled={!r.dailyVisible} onClick={() => openRecords({...dailyCoverage(me,[person],r.days,s.dailyReports),title:`Отчёты дня: ${person.name}`})}>
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
