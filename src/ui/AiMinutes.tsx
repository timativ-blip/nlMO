import { Sparkles, Upload } from "lucide-react";
import { useState } from "react";
import type { MeetingDocumentContent } from "../data/communication-types";
import { sb, FUNCTIONS_URL } from "../lib/supabase";
import { withDeadline } from "../lib/deadline";
import { Button } from "./kit";
export const minutesFields: {
  key: keyof MeetingDocumentContent;
  label: string;
}[] = [
  { key: "agenda", label: "Повестка" },
  { key: "summary", label: "Итоги обсуждения" },
  { key: "decisions", label: "Принятые решения" },
  { key: "actions", label: "Поручения, ответственные и сроки" },
];
export const blankMinutes = (): MeetingDocumentContent => ({
  agenda: "",
  summary: "",
  decisions: "",
  actions: "",
});
async function aiApi<T>(body: Record<string, unknown>): Promise<T> {
  if (!sb) throw new Error("Войдите в рабочую систему.");
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error("Войдите снова.");
  return withDeadline(
    async (signal) => {
      const r = await fetch(FUNCTIONS_URL + "/meeting-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + data.session!.access_token,
        },
        body: JSON.stringify(body),
        signal,
        cache: "no-store",
      });
      const json = await r.json();
      if (!r.ok)
        throw new Error(json.error ?? "Не удалось подготовить протокол.");
      return json;
    },
    65000,
    "Подготовка заняла слишком много времени. Текст сохранён в этом окне, попробуйте ещё раз.",
  );
}
export default function AiMinutes({
  target,
  onApply,
}: {
  target: { meetingId: string } | { archiveId: string };
  onApply: (value: MeetingDocumentContent) => void;
}) {
  const [open, setOpen] = useState(false),
    [ready, setReady] = useState<boolean | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<MeetingDocumentContent | null>(null);
  const show = async () => {
    setOpen((x) => !x);
    if (!open) {
      try {
        const status = await aiApi<{ ready: boolean }>({
          action: "status",
          ...target,
        });
        setReady(status.ready);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await aiApi<{ content: MeetingDocumentContent }>({
        action: "generate",
        ...target,
        transcript: text,
        requestId: crypto.randomUUID(),
      });
      setPreview(result.content);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const file = async (f?: File) => {
    if (!f) return;
    if (f.size > 1024 * 1024) {
      setError("Текстовый файл — до 1 МБ.");
      return;
    }
    if (!/\.(txt|md|vtt|srt)$/i.test(f.name)) {
      setError("Загрузите расшифровку TXT, MD, VTT или SRT.");
      return;
    }
    const value = await f.text();
    if (value.length > 60000) {
      setError("Расшифровка — до 60 000 символов. Разделите её на части.");
      return;
    }
    setText(value);
    setPreview(null);
    setError("");
  };
  return (
    <section className="ai-minutes">
      <Button icon={Sparkles} disabled={busy} onClick={() => void show()}>
        {open ? "Скрыть помощника" : "Протокол из расшифровки"}
      </Button>
      {open && (
        <div className="col" style={{ gap: 12, marginTop: 12 }}>
          <p className="small muted">
            ИИ подготовит черновик. Проверьте решения, имена и сроки, затем
            перенесите текст в протокол. Отправка участникам выполняется
            отдельно.
          </p>
          {ready === false && (
            <p className="callout info" role="status">
              Подключение подготовлено. Для генерации руководителю нужно
              добавить ключ и модель ИИ в защищённые настройки сервера.
              Загружать аудио не требуется.
            </p>
          )}
          <label className="field">
            Расшифровка встречи
            <textarea
              className="input"
              rows={6}
              maxLength={60000}
              disabled={busy}
              aria-label="Расшифровка встречи"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPreview(null);
              }}
              placeholder="Вставьте расшифровку или загрузите текстовый файл"
            />
          </label>
          <div className="row wrap">
            <label className="btn">
              <Upload size={16} />
              Загрузить текст
              <input
                className="sr-only"
                type="file"
                accept=".txt,.md,.vtt,.srt"
                disabled={busy}
                onChange={(e) => void file(e.target.files?.[0])}
              />
            </label>
            <Button
              icon={Sparkles}
              variant="primary"
              disabled={busy || ready !== true || text.trim().length < 30}
              onClick={() => void generate()}
            >
              {busy ? "Готовлю черновик…" : "Подготовить черновик"}
            </Button>
            <span className="small muted">{text.length} / 60 000</span>
          </div>
          {error && (
            <p className="callout danger" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <article className="ai-preview">
              <h3>Предложение ИИ — проверьте перед применением</h3>
              {minutesFields.map((f) => (
                <section key={f.key}>
                  <b>{f.label}</b>
                  <p style={{ whiteSpace: "pre-wrap" }}>
                    {preview[f.key] || "Не указано в расшифровке"}
                  </p>
                </section>
              ))}
              <Button
                variant="primary"
                onClick={() => {
                  onApply(preview);
                  setPreview(null);
                  setOpen(false);
                }}
              >
                Заменить поля протокола этим текстом
              </Button>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
