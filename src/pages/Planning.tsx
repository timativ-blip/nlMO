import {
  FileText,
  Plus,
  Save,
  Send,
  Upload,
  Video,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  headquartersRpc,
  safeHttps,
  useHeadquarters,
  type ArchivedMinutes,
} from "../data/headquarters";
import {
  uploadProtocolFile,
  signedUrl,
  PROTOCOL_PREFIX,
} from "../data/backend";
import { openMeetingMinutes, useCommunications } from "../data/communications";
import { useAppState } from "../data/store";
import type { Attachment } from "../data/types";
import { meetingInput, meetingInstant, meetingWhen } from "../lib/meeting-time";
import { go, type Route } from "../lib/router";
import { useMe } from "../ui/hooks";
import { Button, Modal, toast } from "../ui/kit";
import AiMinutes, { blankMinutes, minutesFields } from "../ui/AiMinutes";
function AttachmentLink({ item }: { item: Attachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    if (item.url.startsWith(PROTOCOL_PREFIX))
      void signedUrl(item.url)
        .then((u) => {
          if (active) setUrl(u);
        })
        .catch(() => {
          if (active) setUrl("");
        });
    else setUrl(safeHttps(item.url));
    return () => {
      active = false;
    };
  }, [item.url]);
  return url ? (
    <a
      className="btn btn-sm"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <FileText size={15} />
      {item.name}
      <ExternalLink size={13} />
    </a>
  ) : (
    <span className="small muted">{item.name} · ссылка недоступна</span>
  );
}
export default function PlanningPage({ route }: { route: Route }) {
  const hq = useHeadquarters(),
    comm = useCommunications();
  const [create, setCreate] = useState(false),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState("all");
  const selected = hq.data?.minutes.find((d) => d.id === route.parts[1]);
  const archived = (hq.data?.minutes ?? []).filter((d) =>
    d.title.toLowerCase().includes(search.toLowerCase()),
  );
  const meetings = comm.meetings.filter((d) =>
    d.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Планёрки</h1>
          <p className="sub">
            История встреч, повестки, протоколы и принятые решения.
          </p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setCreate(true)}>
          Добавить протокол
        </Button>
      </div>
      <div className="hq-toolbar row wrap">
        <div
          className="tabs hq-tabs"
          role="tablist"
          aria-label="Источник планёрок"
        >
          {[
            ["all", "Все"],
            ["video", "Видеовстречи"],
            ["archive", "Загруженные протоколы"],
          ].map(([key, label]) => (
            <button
              role="tab"
              aria-selected={mode === key}
              className={mode === key ? "active" : ""}
              key={key}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ maxWidth: 300 }}
          aria-label="Найти планёрку"
          placeholder="Найти планёрку"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {hq.error && (
        <div className="callout danger" role="alert">
          {hq.error}
          <Button size="sm" icon={RefreshCw} onClick={hq.refresh}>
            Повторить
          </Button>
        </div>
      )}
      {mode !== "video" && (
        <section className="hq-section">
          <h2>Протоколы штаба</h2>
          <div className="hq-list">
            {archived.map((d) => (
              <button
                className="card planning-row"
                key={d.id}
                onClick={() => go("/planning/" + d.id)}
              >
                <span className="resource-icon">
                  <FileText size={21} />
                </span>
                <span className="grow">
                  <b>{d.title}</b>
                  <small>
                    {meetingWhen(d.held_at)} · {d.attachments?.length ?? 0}{" "}
                    файлов
                  </small>
                </span>
                <span className="badge">
                  {d.published_at ? "Опубликован" : "Черновик"}
                </span>
              </button>
            ))}
          </div>
          {!archived.length && (
            <p className="muted">
              {hq.loading
                ? "Загружаю протоколы…"
                : "Добавьте протокол очной встречи или встречи из другого сервиса."}
            </p>
          )}
        </section>
      )}
      {mode !== "archive" && (
        <section className="hq-section">
          <h2>Видеовстречи сайта</h2>
          <div className="hq-list">
            {meetings.map((m) => (
              <article className="card planning-row" key={m.id}>
                <span className="resource-icon">
                  <Video size={21} />
                </span>
                <div className="grow">
                  <h3>{m.title}</h3>
                  <p className="small muted">{meetingWhen(m.startsAt)}</p>
                </div>
                <Button size="sm" onClick={() => openMeetingMinutes(m.id)}>
                  Повестка и протокол
                </Button>
              </article>
            ))}
          </div>
          {!meetings.length && (
            <p className="muted">{comm.error || "Видеовстреч пока нет."}</p>
          )}
        </section>
      )}
      {route.parts[1] && !selected && !hq.loading && !hq.error && (
        <p className="callout info">
          Протокол не найден или вам не предоставлен доступ к нему.
        </p>
      )}
      {(create || selected) && (
        <ArchiveEditor
          key={selected?.id ?? "new"}
          value={selected}
          onClose={() => {
            setCreate(false);
            if (route.parts[1]) go("/planning");
          }}
          onSaved={hq.refresh}
        />
      )}
    </>
  );
}
function ArchiveEditor({
  value,
  onClose,
  onSaved,
}: {
  value?: ArchivedMinutes;
  onClose: () => void;
  onSaved: () => void;
}) {
  const s = useAppState(),
    me = useMe(),
    people = s.users.filter(
      (u) => u.active && !u.pending && u.role !== "member",
    );
  const [doc, setDoc] = useState(value),
    [title, setTitle] = useState(value?.title ?? ""),
    [at, setAt] = useState(() =>
      meetingInput(value?.held_at ?? new Date().toISOString()),
    ),
    [responsible, setResponsible] = useState(value?.responsible_id ?? me.id),
    [content, setContent] = useState(value?.content ?? blankMinutes),
    [files, setFiles] = useState<Attachment[]>(value?.attachments ?? []),
    [participants, setParticipants] = useState(
      value?.participant_ids ?? people.map((p) => p.id),
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const editable = doc?.can_edit ?? true,
    id = useRef(value?.id ?? crypto.randomUUID()).current;
  const payload = JSON.stringify({
      title,
      at,
      responsible,
      content,
      files,
      participants,
    }),
    saved = useRef(payload),
    dirty = payload !== saved.current;
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  const close = () => {
    if (!busy) {
      if (dirty) setConfirmClose(true);
      else onClose();
    }
  };
  const persist = async () => {
    if (title.trim().length < 3)
      throw new Error("Название планёрки — от 3 до 120 символов.");
    const next = await headquartersRpc<ArchivedMinutes>("minutes_save", {
      id,
      title,
      heldAt: meetingInstant(at),
      responsibleId: responsible,
      content,
      attachments: files,
      participantIds: participants,
      version: doc?.version,
      requestId: crypto.randomUUID(),
    });
    setDoc(next);
    saved.current = payload;
    onSaved();
    return next;
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await persist();
      toast("Протокол сохранён.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    setBusy(true);
    setError("");
    try {
      const next = dirty || !doc ? await persist() : doc;
      const published = await headquartersRpc<ArchivedMinutes>(
        "minutes_publish",
        { id, version: next.version, requestId: crypto.randomUUID() },
      );
      setDoc(published);
      setConfirm(false);
      onSaved();
      toast("Протокол опубликован. Участники получат уведомления.");
    } catch (e) {
      setConfirm(false);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Файл больше 10 МБ. Добавьте ссылку на облако.");
      return;
    }
    if (files.length >= 10) {
      setError("Можно приложить до 10 файлов.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const url = await uploadProtocolFile(me.id, file, file.name);
      setFiles((x) => [
        ...x,
        {
          id: crypto.randomUUID(),
          name: file.name.slice(0, 180),
          url,
          kind: "file",
          size: file.size,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Modal
        open
        title={doc ? "Протокол планёрки" : "Добавить планёрку"}
        width={900}
        onClose={close}
        footer={
          <>
            <Button disabled={busy} onClick={close}>
              Закрыть
            </Button>
            {editable && (
              <>
                <Button
                  icon={Save}
                  disabled={busy || (!!doc && !dirty)}
                  onClick={() => void save()}
                >
                  Сохранить
                </Button>
                <Button
                  variant="primary"
                  icon={Send}
                  disabled={
                    busy ||
                    (!!doc && !dirty && doc.published_version === doc.version)
                  }
                  onClick={() => setConfirm(true)}
                >
                  Отправить участникам
                </Button>
              </>
            )}
          </>
        }
      >
        <div className="col" style={{ gap: 16 }}>
          {error && (
            <p className="callout danger" role="alert">
              {error}
            </p>
          )}
          <div className="grid g-2">
            <label className="field">
              Название
              <input
                className="input"
                minLength={3}
                maxLength={120}
                value={title}
                disabled={!editable || busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              Дата встречи · МСК
              <input
                className="input"
                type="datetime-local"
                value={at}
                disabled={!editable || busy}
                onChange={(e) => setAt(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            Ответственный за повестку и протокол
            <select
              className="input"
              aria-label="Ответственный за повестку и протокол"
              value={responsible}
              disabled={!editable || busy}
              onChange={(e) => setResponsible(e.target.value)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {editable && doc && (
            <AiMinutes target={{ archiveId: id }} onApply={setContent} />
          )}
          {editable && !doc && (
            <p className="small muted">
              Сохраните планёрку, чтобы подготовить ИИ-протокол из расшифровки.
            </p>
          )}
          {minutesFields.map((f) => (
            <label className="field" key={f.key}>
              {f.label}
              <textarea
                className="input"
                rows={4}
                maxLength={8000}
                aria-label={f.label}
                value={content[f.key]}
                disabled={!editable || busy}
                onChange={(e) =>
                  setContent({ ...content, [f.key]: e.target.value })
                }
              />
            </label>
          ))}
          <section>
            <h3>Файлы протокола</h3>
            <div className="col" style={{ gap: 8, marginTop: 8 }}>
              {files.map((f) => (
                <div key={f.id} className="row wrap">
                  <AttachmentLink item={f} />
                  {editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        setFiles(files.filter((x) => x.id !== f.id))
                      }
                    >
                      Убрать
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {editable && (
              <label className="btn" style={{ marginTop: 12 }}>
                <Upload size={16} />
                Прикрепить файл до 10 МБ
                <input
                  className="sr-only"
                  type="file"
                  disabled={busy}
                  onChange={(e) => void upload(e.target.files?.[0])}
                />
              </label>
            )}
          </section>
          {editable && (
            <fieldset className="hq-participants">
              <legend>Участники и получатели протокола</legend>
              <label className="row">
                <input
                  type="checkbox"
                  checked={participants.length === people.length}
                  onChange={(e) =>
                    setParticipants(
                      e.target.checked ? people.map((p) => p.id) : [],
                    )
                  }
                  disabled={busy}
                />
                Вся рабочая команда
              </label>
              {people.map((p) => (
                <label className="row" key={p.id}>
                  <input
                    type="checkbox"
                    checked={participants.includes(p.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setParticipants(
                        e.target.checked
                          ? [...participants, p.id]
                          : participants.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
            </fieldset>
          )}
          <p className="small muted" role="status">
            {dirty
              ? "Есть несохранённые изменения."
              : doc?.published_at
                ? `Опубликован ${meetingWhen(doc.published_at)}. Новые правки нужно отправить отдельно.`
                : "Черновик видят автор, ответственный и штаб."}
          </p>
        </div>
      </Modal>
      <Modal
        open={confirm}
        title="Отправить протокол участникам?"
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        footer={
          <>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              Вернуться
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void publish()}
            >
              {busy ? "Отправляю…" : "Да, отправить"}
            </Button>
          </>
        }
      >
        <p>
          Получат выбранные участники, автор и ответственный. Уведомления
          появятся на сайте и в подключённом Telegram с учётом настроек.
        </p>
      </Modal>
      <Modal
        open={confirmClose}
        title="Закрыть без сохранения?"
        onClose={() => setConfirmClose(false)}
        footer={
          <>
            <Button onClick={() => setConfirmClose(false)}>Продолжить</Button>
            <Button onClick={onClose}>Закрыть без сохранения</Button>
          </>
        }
      >
        <p>Несохранённые правки будут потеряны.</p>
      </Modal>
    </>
  );
}
