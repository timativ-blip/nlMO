import {
  Building2,
  Package,
  Plus,
  RefreshCw,
  Pencil,
  CalendarClock,
} from "lucide-react";
import { useState } from "react";
import {
  headquartersRpc,
  reservationLabel,
  useHeadquarters,
  type Reservation,
  type Resource,
} from "../data/headquarters";
import { meetingInput, meetingInstant, meetingWhen } from "../lib/meeting-time";
import { useAppState } from "../data/store";
import { useMe } from "../ui/hooks";
import { Button, Modal, toast } from "../ui/kit";
const next = () =>
  meetingInput(
    new Date(Math.ceil((Date.now() + 600000) / 900000) * 900000).toISOString(),
  );
export default function ResourcesPage({ kind }: { kind: Resource["kind"] }) {
  const me = useMe(),
    s = useAppState(),
    hq = useHeadquarters(),
    manager = ["head", "staff"].includes(me.role),
    equipment = kind === "equipment";
  const [edit, setEdit] = useState<Partial<Resource> | null>(null),
    [reserve, setReserve] = useState<Resource | null>(null),
    [change, setChange] = useState<{
      row: Reservation;
      status: Reservation["status"];
    } | null>(null);
  const [start, setStart] = useState(next),
    [end, setEnd] = useState(() =>
      meetingInput(new Date(Date.now() + 7200000).toISOString()),
    ),
    [purpose, setPurpose] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("current");
  const resources = hq.data?.resources.filter((r) => r.kind === kind) ?? [],
    rows = (hq.data?.reservations ?? []).filter((r) =>
      resources.some((x) => x.id === r.resource_id),
    );
  const name = (id: string) =>
    s.users.find((u) => u.id === id)?.name ?? "Сотрудник";
  const close = () => {
    if (busy) return;
    setEdit(null);
    setReserve(null);
    setChange(null);
    setError("");
  };
  const act = async () => {
    setBusy(true);
    setError("");
    try {
      if (edit && (edit.name?.trim().length ?? 0) < 2)
        throw new Error("Название — от 2 до 120 символов.");
      if (reserve && purpose.trim().length < 3)
        throw new Error("Напишите цель бронирования — от 3 символов.");
      if (edit)
        await headquartersRpc("resource_save", {
          ...edit,
          kind,
          requestId: crypto.randomUUID(),
        });
      else if (reserve)
        await headquartersRpc("reserve", {
          resourceId: reserve.id,
          startsAt: meetingInstant(start),
          endsAt: meetingInstant(end),
          purpose,
          requestId: crypto.randomUUID(),
        });
      else if (change)
        await headquartersRpc("reservation_update", {
          id: change.row.id,
          version: change.row.version,
          status: change.status,
          note,
          requestId: crypto.randomUUID(),
        });
      setEdit(null);
      setReserve(null);
      setChange(null);
      hq.refresh();
      toast("Изменения сохранены.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const show = (r: Resource) => {
    setReserve(r);
    setStart(next());
    setEnd(meetingInput(new Date(Date.now() + 7200000).toISOString()));
    setPurpose("");
    setError("");
  };
  const visible = rows.filter(
    (r) =>
      filter === "all" ||
      (filter === "mine" && r.borrower_id === me.id) ||
      (filter === "current" &&
        (r.status === "issued" ||
          (r.status === "reserved" && Date.parse(r.ends_at) > Date.now()))),
  );
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{equipment ? "Оборудование и инвентарь" : "Бронь штаба"}</h1>
          <p className="sub">
            {equipment
              ? "Бронируйте, отмечайте получение и возврат. У каждой вещи есть ответственный."
              : "Выберите пространство и время. Пересечения брони проверяются автоматически."}
          </p>
        </div>
        {manager && (
          <Button
            icon={Plus}
            onClick={() => {
              setError("");
              setEdit({ name: "", code: "", description: "", active: true });
            }}
          >
            {equipment ? "Добавить оборудование" : "Добавить пространство"}
          </Button>
        )}
      </div>
      {hq.error && (
        <div className="callout danger" role="alert">
          {hq.error}
          <Button size="sm" icon={RefreshCw} onClick={hq.refresh}>
            Повторить
          </Button>
        </div>
      )}
      {hq.loading && <p role="status">Загружаю бронирования…</p>}
      <div className="resource-grid">
        {resources.map((r) => {
          const held = rows.find(
            (b) => b.resource_id === r.id && b.status === "issued",
          );
          return (
            <article className="card resource-card" key={r.id}>
              <span className="resource-icon">
                {equipment ? <Package size={23} /> : <Building2 size={23} />}
              </span>
              <div className="grow">
                <h2>{r.name}</h2>
                {r.code && <p className="small muted">Инв. № {r.code}</p>}
                <p className="muted">{r.description}</p>
                {held && (
                  <p
                    className={
                      Date.parse(held.ends_at) < Date.now()
                        ? "danger-text"
                        : "small"
                    }
                  >
                    На руках: {name(held.borrower_id)} · до{" "}
                    {meetingWhen(held.ends_at)}
                  </p>
                )}
                {!r.active && (
                  <span className="badge">Временно недоступно</span>
                )}
              </div>
              <div className="row wrap">
                <Button
                  variant="primary"
                  icon={CalendarClock}
                  disabled={!r.active || !!held}
                  onClick={() => show(r)}
                >
                  Забронировать
                </Button>
                {manager && (
                  <Button
                    icon={Pencil}
                    size="sm"
                    onClick={() => {
                      setError("");
                      setEdit(r);
                    }}
                  >
                    Изменить
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!hq.loading && !resources.length && (
        <div className="card empty">
          <Package size={30} />
          <h2>Каталог пока пуст</h2>
          <p className="muted">
            Штаб добавляет каждую физическую вещь отдельно, с названием и
            инвентарным номером.
          </p>
        </div>
      )}
      <section className="hq-section">
        <div className="row wrap">
          <h2 className="grow">
            {equipment ? "Брони и выдачи" : "Расписание брони"}
          </h2>
          <div
            className="tabs hq-tabs"
            role="tablist"
            aria-label="Фильтр бронирований"
          >
            {[
              ["current", "Текущие"],
              ["mine", "Мои"],
              ["all", "История"],
            ].map(([key, label]) => (
              <button
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? "active" : ""}
                key={key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="hq-list">
          {visible
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
            .map((r) => (
              <article key={r.id} className="card booking-row">
                <div className="grow">
                  <div className="row wrap">
                    <b>{resources.find((x) => x.id === r.resource_id)?.name}</b>
                    <span
                      className={`badge ${r.status === "issued" && Date.parse(r.ends_at) < Date.now() ? "st-overdue" : ""}`}
                    >
                      {reservationLabel(r)}
                    </span>
                  </div>
                  <p>
                    {meetingWhen(r.starts_at)} — {meetingWhen(r.ends_at)}
                  </p>
                  <p className="small muted">
                    {name(r.borrower_id)}
                    {r.district_id ? ` · округ ${r.district_id}` : ""} ·{" "}
                    {r.purpose}
                  </p>
                  {r.issue_note && (
                    <p className="small">При получении: {r.issue_note}</p>
                  )}
                  {r.returned_at && (
                    <p className="small muted">
                      Возвращено {meetingWhen(r.returned_at)} ·{" "}
                      {r.return_note || "без замечаний"}
                    </p>
                  )}
                </div>
                {(manager || r.borrower_id === me.id) && (
                  <div className="row wrap">
                    {equipment &&
                      r.status === "reserved" &&
                      Date.parse(r.starts_at) <= Date.now() + 1800000 &&
                      Date.parse(r.ends_at) > Date.now() && (
                        <Button
                          variant="primary"
                          onClick={() => {
                            setNote("");
                            setChange({ row: r, status: "issued" });
                          }}
                        >
                          Я получил
                        </Button>
                      )}
                    {equipment && r.status === "issued" && (
                      <Button
                        variant="primary"
                        onClick={() => {
                          setNote("");
                          setChange({ row: r, status: "returned" });
                        }}
                      >
                        Я вернул
                      </Button>
                    )}
                    {r.status === "reserved" &&
                      Date.parse(r.ends_at) > Date.now() && (
                        <Button
                          onClick={() => {
                            setNote("");
                            setChange({ row: r, status: "cancelled" });
                          }}
                        >
                          Отменить бронь
                        </Button>
                      )}
                  </div>
                )}
              </article>
            ))}
        </div>
        {!visible.length && !hq.loading && (
          <p className="muted">В этом списке пока нет бронирований.</p>
        )}
      </section>
      <Modal
        open={!!edit || !!reserve || !!change}
        onClose={close}
        title={
          edit
            ? edit.id
              ? "Изменить ресурс"
              : equipment
                ? "Новое оборудование"
                : "Новое пространство"
            : reserve
              ? "Бронирование"
              : change?.status === "issued"
                ? "Подтвердить получение"
                : change?.status === "returned"
                  ? "Подтвердить возврат"
                  : "Отменить бронь?"
        }
        footer={
          <>
            <Button disabled={busy} onClick={close}>
              Закрыть
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void act()}
            >
              {busy
                ? "Сохраняю…"
                : change?.status === "cancelled"
                  ? "Да, отменить"
                  : "Сохранить"}
            </Button>
          </>
        }
      >
        <div className="col" style={{ gap: 14 }}>
          {edit && (
            <>
              <label className="field">
                Название
                <input
                  className="input"
                  maxLength={120}
                  value={edit.name ?? ""}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              {equipment && (
                <label className="field">
                  Инвентарный номер
                  <input
                    className="input"
                    maxLength={80}
                    value={edit.code ?? ""}
                    onChange={(e) => setEdit({ ...edit, code: e.target.value })}
                  />
                </label>
              )}
              <label className="field">
                Описание
                <textarea
                  className="input"
                  maxLength={2000}
                  value={edit.description ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, description: e.target.value })
                  }
                />
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={!!edit.active}
                  onChange={(e) =>
                    setEdit({ ...edit, active: e.target.checked })
                  }
                />
                Доступно для бронирования
              </label>
            </>
          )}
          {reserve && (
            <>
              <h3>{reserve.name}</h3>
              <div className="grid g-2">
                <label className="field">
                  Начало · МСК
                  <input
                    className="input"
                    type="datetime-local"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label className="field">
                  Окончание · МСК
                  <input
                    className="input"
                    type="datetime-local"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
              </div>
              <label className="field">
                Для чего бронируете
                <textarea
                  className="input"
                  maxLength={1000}
                  aria-label="Для чего бронируете"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </label>
              <p className="small muted">
                Ответственный: {me.name}.{" "}
                {equipment
                  ? "После фактического получения нажмите «Я получил», при возврате — «Я вернул»."
                  : "Бронь действует только в указанное время."}
              </p>
            </>
          )}
          {change && change.status !== "cancelled" && (
            <>
              <p>
                Вы отмечаете фактическое{" "}
                {change.status === "issued" ? "получение" : "возвращение"}{" "}
                оборудования. Это увидят коллеги и штаб.
              </p>
              <label className="field">
                Состояние и комплектность
                <textarea
                  className="input"
                  maxLength={2000}
                  aria-label="Состояние и комплектность"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Комплект полный, без повреждений"
                />
              </label>
            </>
          )}
          {error && (
            <p className="callout danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
