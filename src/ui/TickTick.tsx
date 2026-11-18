import { CheckSquare, ExternalLink, RefreshCw, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { canCreateTask } from "../data/perm";
import { DEMO_MODE } from "../data/store";
import { fmtDate, fmtStamp } from "../lib/date";
import { withDeadline } from "../lib/deadline";
import { go, useRoute } from "../lib/router";
import { sb } from "../lib/supabase";
import { openNewTask } from "./global";
import { useMe } from "./hooks";
import { Button, Empty, toast } from "./kit";

interface TickTask {
  id: string;
  project: string;
  title: string;
  description: string;
  dueDay: string | null;
  status: "active" | "completed";
  priority: number;
}
interface Snapshot {
  ready: boolean;
  connected: boolean;
  selected: string[];
  tasks: TickTask[];
  syncedAt: string | null;
  error: "" | "reconnect" | "unavailable";
  projects?: { id: string; name: string }[];
  authorizationUrl?: string;
  revoked?: boolean;
}
const unavailable: Snapshot = { ready: false, connected: false, selected: [], tasks: [], syncedAt: null, error: "" };

async function request(action: string, body: Record<string, unknown> = {}): Promise<Snapshot> {
  if (!sb) return unavailable;
  const { data, error } = await withDeadline(
    () => sb!.functions.invoke("ticktick", { body: { action, ...body } }),
    action === "sync" ? 45000 : 16000,
    "TickTick пока не ответил. Повторите попытку позже.",
  );
  if (error) throw new Error("Сервис TickTick пока недоступен. Повторите попытку позже.");
  if (data?.requestError) throw new Error(data.requestError);
  return data;
}

function useSnapshot(poll = false, enabled = true) {
  const [state, setState] = useState<Snapshot>();
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => {
      void request("status").then((value) => {
        if (active) {
          setState(value);
          setMessage("");
        }
      }, (error: Error) => { if (active) setMessage(error.message); });
    };
    load();
    const timer = poll ? window.setInterval(() => document.visibilityState === "visible" && load(), 45000) : undefined;
    return () => { active = false; window.clearInterval(timer); };
  }, [poll, enabled]);
  return { state, setState, message, setMessage };
}

function syncStatus(state: Snapshot) {
  if (state.error === "reconnect") return "Подключите TickTick заново, чтобы обновить задачи.";
  if (state.error === "unavailable") return "TickTick временно не ответил. Показываем последнюю полученную версию.";
  if (state.syncedAt) return "Обновлено " + fmtStamp(state.syncedAt);
  return state.selected.length ? "Списки сохранены. Ожидается первое обновление." : "Выберите списки TickTick для синхронизации.";
}

export function TickTickSettings() {
  const me = useMe();
  return <TickSettingsCard key={me.id} />;
}

function TickSettingsCard() {
  const me = useMe();
  const route = useRoute();
  const stateKey = "nlmo-ticktick-state:" + me.id;
  const [handlingCallback, setHandlingCallback] = useState(() => route.query.has("ticktick"));
  const handledCallback = useRef(false);
  const { state, setState, message, setMessage } = useSnapshot(false, !handlingCallback);
  const [busy, setBusy] = useState(handlingCallback);
  const [projects, setProjects] = useState<Snapshot["projects"]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [oauthMessage, setOauthMessage] = useState("");
  useEffect(() => {
    const result = route.query.get("ticktick");
    if (!result || handledCallback.current) return;
    handledCallback.current = true;
    const oauthState = route.query.get("state"), code = route.query.get("code");
    history.replaceState(history.state, "", "#/settings");
    let savedState = "";
    try {
      savedState = sessionStorage.getItem(stateKey) ?? "";
      sessionStorage.removeItem(stateKey);
    } catch { /* Private browser storage is unavailable. */ }
    if (result === "confirm" && code && oauthState && savedState === oauthState) {
      void request("complete", { state: oauthState, code }).then((next) => {
        setState(next);
        setOauthMessage("TickTick подключён. Выберите рабочие списки.");
      }, (error: Error) => {
        setOauthMessage(error.message);
      }).finally(() => {
        setHandlingCallback(false);
        setBusy(false);
      });
    } else {
      setOauthMessage(result === "cancelled" ? "Подключение отменено." :
        "Подключение нужно завершить в исходной вкладке. Повторите попытку.");
      setHandlingCallback(false);
      setBusy(false);
    }
  }, [route.query, stateKey, setState]);

  async function act(action: "start" | "projects" | "save" | "disconnect" | "status") {
    setMessage("");
    setOauthMessage("");
    setBusy(true);
    try {
      const next = await request(action, action === "save" ? { projects: selected } : {});
      if (action === "start") {
        if (!next.authorizationUrl || new URL(next.authorizationUrl).origin !== "https://ticktick.com")
          throw new Error("Не удалось открыть TickTick.");
        const oauthState = new URL(next.authorizationUrl).searchParams.get("state");
        if (!oauthState) throw new Error("Не удалось открыть TickTick.");
        sessionStorage.setItem(stateKey, oauthState);
        location.assign(next.authorizationUrl);
        return;
      }
      setState(next);
      if (action === "projects") {
        setProjects(next.projects);
        setSelected(next.selected);
      } else {
        setProjects(undefined);
      }
      if (action === "save") toast("Списки сохранены. Задачи появятся после синхронизации.");
      if (action === "disconnect") {
        toast(next.revoked ? "TickTick отключён" :
          "TickTick отключён на сайте. Доступ приложения можно отозвать в настройках TickTick.");
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="card card-pad col integration-card">
    <h2 className="row"><CheckSquare size={20} /> TickTick</h2>
    <p className="small muted">Выберите списки из своего аккаунта. Задачи появятся в вашем личном разделе.</p>
    {oauthMessage && <p className="small" role="status">{oauthMessage}</p>}
    {message && <p className="callout danger" role="alert">{message}</p>}
    {DEMO_MODE ? <p className="small muted">Подключение доступно в рабочем кабинете.</p>
      : !state ? <Button size="sm" disabled={busy} onClick={() => void act("status")}>Проверить подключение</Button>
      : !state.ready ? <p className="small muted">Ожидается настройка приложения TickTick.</p>
      : <div className="col integration-card">
        {state.connected && <p className="small" role="status">{syncStatus(state)}</p>}
        <div className="row wrap">
          {(!state.connected || state.error === "reconnect") && <Button variant="primary" icon={ExternalLink} disabled={busy}
            onClick={() => void act("start")}>{state.connected ? "Подключить заново" : "Подключить TickTick"}</Button>}
          {state.connected && state.error !== "reconnect" && <Button disabled={busy} onClick={() => void act("projects")}>Выбрать списки</Button>}
          {state.connected && <Button disabled={busy} onClick={() => void act("disconnect")}>Отключить</Button>}
          {state.connected && <Button onClick={() => go("/tasks/ticktick")}>Открыть задачи</Button>}
        </div>
      </div>}
    {projects && <div className="col ticktick-projects">
      <h3>Списки для синхронизации</h3>
      {!projects.length && <p className="small muted">Создайте обычный список в TickTick и добавьте в него задачи.</p>}
      {projects.map((project) => <label className="row" key={project.id}>
        <input type="checkbox" checked={selected.includes(project.id)} onChange={(event) => setSelected((ids) =>
          event.target.checked ? [...ids, project.id] : ids.filter((id) => id !== project.id))} />{project.name}
      </label>)}
      <div><Button variant="primary" disabled={busy} onClick={() => void act("save")}>Сохранить списки</Button></div>
    </div>}
  </section>;
}

export function TickTickTasks() {
  const me = useMe();
  return <TickTasksPage key={me.id} />;
}

function TickTasksPage() {
  const me = useMe();
  const { state, setState, message, setMessage } = useSnapshot(true);
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setMessage("");
    try { setState(await request("sync")); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  const tasks = state?.tasks.filter((task) => task.status === (completed ? "completed" : "active")) ?? [];
  return <>
    <div className="page-head">
      <div className="grow"><h1>Мои задачи из TickTick</h1><p className="sub">Видны только вам · {state ? syncStatus(state) : "загружаю задачи"}</p></div>
      <Button onClick={() => go("/tasks")}>Задачи команды</Button>
      <Button icon={Settings} onClick={() => go("/settings")}>Подключение</Button>
      {state?.connected && state.selected.length > 0 && <Button icon={RefreshCw} disabled={busy} onClick={() => void refresh()}>{busy ? "Обновляю…" : "Обновить"}</Button>}
    </div>
    {message && <p className="callout danger" role="alert">{message}</p>}
    <section className="card card-pad col integration-card">
      <div className="row wrap">
        <button type="button" className={`chip ${completed ? "" : "on"}`} aria-pressed={!completed} onClick={() => setCompleted(false)}>Активные</button>
        <button type="button" className={`chip ${completed ? "on" : ""}`} aria-pressed={completed} onClick={() => setCompleted(true)}>Завершённые за 30 дней</button>
      </div>
      {state && !tasks.length && <Empty icon={CheckSquare}
        title={!state.connected ? "Подключите TickTick в настройках" : state.selected.length ? "Пока нет задач в этом списке" : "Выберите списки в настройках"} />}
      {tasks.map((task) => <article className="budget-expense" key={task.id}>
        <div className="grow budget-expense-copy">
          <b>{task.title}</b>
          <p className="small muted">{task.project}{task.dueDay ? " · до " + fmtDate(task.dueDay) : ""}</p>
          {task.description && <details><summary className="small">Описание</summary><p>{task.description}</p></details>}
        </div>
        {canCreateTask(me) && <Button size="sm" onClick={() => openNewTask({
          title: task.title, description: task.description, due: task.dueDay ?? undefined,
          priority: task.priority >= 5 ? "urgent" : task.priority >= 3 ? "high" : task.priority === 1 ? "low" : "normal",
          districtId: me.districtId ?? undefined, assigneeId: me.id,
        })}>Создать рабочую задачу</Button>}
      </article>)}
    </section>
  </>;
}
