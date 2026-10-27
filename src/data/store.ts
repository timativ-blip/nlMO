// Хранилище приложения: состояние в памяти, подписка через useSyncExternalStore.
// Каждое действие проверяет права (см. perm.ts), пишет историю и уведомления.
// Демо: данные в localStorage. Рабочий режим (заданы VITE_SUPABASE_*): изменения отправляются
// в Supabase (см. backend.ts), где их перепроверяют RLS и триггеры; при отказе состояние откатывается.
import { useSyncExternalStore } from 'react';
import { addDays, nowMsk, stamp, todayISO, weekStart } from '../lib/date';
import { BACKEND, sb } from '../lib/supabase';
import * as B from './backend';
import * as P from './perm';
import { createSeed, DATA_VERSION } from './seed';
import type { Attachment, CalEvent, Notification, Report, State, Task, TaskResult, UiPrefs, User, Weights } from './types';
import { PRIORITY_LABEL, STATUS_LABEL } from './types';

const KEY = 'kc-mo-demo';
export const DEMO_MODE = !BACKEND;

export class AppError extends Error {}
const deny = (msg = 'Недостаточно прав для этого действия. Обратитесь к координатору или руководителю.') => {
  throw new AppError(msg);
};

const DEFAULT_UI: UiPrefs = { period: 'month', districtId: 'all', taskView: 'list', notify: { assign: true, comment: true, review: true, event: true, report: true, deadline: true } };
function emptyState(): State {
  return {
    version: DATA_VERSION, seededAt: stamp(), users: [], districts: [], tasks: [], events: [], reports: [], dailyReports: [], metrics: [], notifications: [], audit: [],
    weights: { personCompletion: 40, personOnTime: 30, personVolume: 30, districtPlan: 50, districtCompletion: 25, districtOnTime: 25, priority: { low: 0.5, normal: 1, high: 1.5, urgent: 2 }, lateFactor: 0.7, minTasks: 3 },
    ui: DEFAULT_UI, session: { userId: '' }, extras: {},
  };
}

let state: State = BACKEND ? emptyState() : load();
const listeners = new Set<() => void>();
let saveError: ((m: string) => void) | null = null;
export const onSaveError = (fn: (m: string) => void) => (saveError = fn);

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s.version === DATA_VERSION) return ensureReports(s);
    }
  } catch {
    /* повреждённые данные — пересоздаём демо */
  }
  return ensureReports(createSeed());
}

// Недельный отчёт каждого округа создаётся автоматически
function ensureReports(s: State, onlyFor?: (districtId: string) => boolean): State {
  const ws = weekStart(todayISO());
  for (const d of s.districts) {
    const rid = `r_${d.id}_${ws}`;
    if (onlyFor && !onlyFor(d.id)) continue;
    if (!s.reports.some((r) => r.id === rid))
      s.reports.push({ id: rid, districtId: d.id, weekStart: ws, status: 'draft', conclusions: '', problems: '', plan: '', updatedAt: stamp(), history: [] });
  }
  return s;
}

const uiKey = () => `kc-ui-${state.session.userId}`;
function persist() {
  try {
    if (BACKEND) localStorage.setItem(uiKey(), JSON.stringify(state.ui));
    else localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    saveError?.('Не удалось сохранить: память браузера заполнена. Удалите крупные вложения или сбросьте демо-данные в настройках.');
  }
}

function emit() {
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
if (!BACKEND)
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) {
      state = JSON.parse(e.newValue);
      emit();
    }
  });

export const useAppState = () => useSyncExternalStore(subscribe, () => state);
export const getState = () => state;

/* ───────── Фаза приложения (рабочий режим): загрузка, вход, первый запуск ───────── */
export type Phase = 'loading' | 'signed-out' | 'setup' | 'ready' | 'error' | 'pending';
let phase: Phase = BACKEND ? 'loading' : 'ready';
let phaseError = '';
const phaseSubs = new Set<() => void>();
const setPhase = (p: Phase, err = '') => { phase = p; phaseError = err; phaseSubs.forEach((f) => f()); };
export const usePhase = () => {
  const p = useSyncExternalStore((f) => { phaseSubs.add(f); return () => { phaseSubs.delete(f); }; }, () => phase);
  return { phase: p, error: phaseError };
};

let queue: Promise<unknown> = Promise.resolve();
function mutate(fn: (d: State, me: User) => void) {
  const prev = state;
  const draft: State = structuredClone(state);
  const me = draft.users.find((u) => u.id === draft.session.userId)!;
  fn(draft, me);
  state = draft;
  if (BACKEND) {
    const { changes, weights } = B.diff(prev, draft, draft.session.userId);
    // Чужие уведомления отправляются в базу, но в локальном состоянии не хранятся
    state = { ...state, notifications: state.notifications.filter((n) => n.userId === state.session.userId) };
    if (changes.length || weights) {
      setSyncing(+1);
      queue = queue
        .then(() => B.push(changes, weights))
        .then((saved) => saved.forEach((x) => applyRemote(x.table, x.data)))
        .catch((e: Error) => {
          saveError?.(`Не сохранено: ${e.message}`);
          return refresh();
        })
        .finally(() => setSyncing(-1));
    }
  }
  persist();
  emit();
}

/* ───────── Рабочий режим: загрузка и онлайн-обновления ───────── */
let syncing = 0;
const syncSubs = new Set<() => void>();
function setSyncing(d: number) { syncing += d; syncSubs.forEach((f) => f()); }
export const useSyncing = () => useSyncExternalStore((f) => { syncSubs.add(f); return () => { syncSubs.delete(f); }; }, () => syncing > 0);

function applyRemote(table: string, data: unknown, deleted = false) {
  const c = B.COLLECTION_OF[table];
  if (!c || !data) return;
  const item = data as { id: string; userId?: string };
  if (c === 'notifications' && item.userId !== state.session.userId) return;
  const list = state[c] as { id: string }[];
  const i = list.findIndex((x) => x.id === item.id);
  const next = deleted ? list.filter((x) => x.id !== item.id) : i >= 0 ? list.map((x, j) => (j === i ? item : x)) : c === 'notifications' ? [item, ...list] : [...list, item];
  state = { ...state, [c]: next };
  emit();
}

async function refresh() {
  const uid = state.session.userId;
  const data = await B.loadAll(uid);
  const { telegramBot, telegramLinked, ...rest } = data;
  let ui = DEFAULT_UI;
  try { ui = { ...DEFAULT_UI, ...JSON.parse(localStorage.getItem(`kc-ui-${uid}`) || '{}') }; } catch { /* по умолчанию */ }
  state = { ...state, ...rest, weights: rest.weights ?? state.weights, ui, extras: { telegramBot, telegramLinked } } as State;
  const me = state.users.find((u) => u.id === uid);
  if (me?.role === 'head') state = { ...state, audit: await B.loadAudit() };
  emit();
  return me;
}

let channel: ReturnType<NonNullable<typeof sb>['channel']> | null = null;
async function boot(uid: string) {
  setPhase('loading');
  state = { ...emptyState(), session: { userId: uid } };
  try {
    const me = await refresh();
    if (!me) {
      const st = await B.myStatus();
      if (st.pending) { setPhase('pending', st.name ?? ''); return; }
      setPhase('error', st.exists ? 'Ваша учётная запись отключена. Обратитесь к руководителю области или координатору округа.' : 'Учётная запись найдена, но профиль не создан. Обратитесь к руководителю области.');
      return;
    }
    if (me.active === false) { setPhase('error', 'Ваша учётная запись отключена. Обратитесь к руководителю области.'); return; }
    setPhase('ready');
    // Черновики недельных отчётов создаёт тот, у кого есть право (руководитель или координатор)
    const can = (d: string) => me.role === 'head' || (me.role === 'coordinator' && me.districtId === d);
    if (state.districts.some((d) => can(d.id))) mutate((s) => { ensureReports(s, can); });
    channel?.unsubscribe();
    channel = sb!.channel('kc-live');
    for (const t of ['tasks', 'events', 'reports', 'profiles', 'districts', 'metrics', 'daily_reports']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, (p) => applyRemote(t, (p.new as { data?: unknown })?.data ?? (p.old as { data?: unknown })?.data, p.eventType === 'DELETE'));
    }
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (p) => applyRemote('notifications', (p.new as { data: unknown }).data));
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, (p) => {
      const row = p.new as { key: string; value: unknown };
      if (row.key === 'weights') { state = { ...state, weights: row.value as Weights }; emit(); }
      if (row.key === 'telegram') { state = { ...state, extras: { ...state.extras, telegramBot: (row.value as { username: string }).username } }; emit(); }
    });
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'telegram_links' }, (p) => {
      state = { ...state, extras: { ...state.extras, telegramLinked: p.eventType !== 'DELETE' } };
      emit();
    });
    channel.subscribe();
  } catch (e) {
    setPhase('error', e instanceof Error ? e.message : 'Не удалось загрузить данные.');
  }
}

if (BACKEND) {
  (async () => {
    const { data } = await sb!.auth.getSession();
    if (data.session) return boot(data.session.user.id);
    const { data: inited } = await sb!.rpc('is_initialized');
    setPhase(inited === false ? 'setup' : 'signed-out');
  })().catch(() => setPhase('error', 'Нет связи с сервером. Проверьте интернет и обновите страницу.'));
  sb!.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      channel?.unsubscribe(); state = emptyState(); emit();
      sb!.rpc('is_initialized').then(({ data }) => setPhase(data === false ? 'setup' : 'signed-out'), () => setPhase('signed-out'));
    }
    if (event === 'SIGNED_IN' && session && session.user.id !== state.session.userId) boot(session.user.id);
  });
}

export async function signIn(email: string, password: string) {
  const { error } = await sb!.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw new AppError(/invalid/i.test(error.message) ? 'Неверная почта или пароль. Если забыли пароль — попросите руководителя или координатора сбросить его.' : B.humanError(error.message));
}
export const signOut = () => sb!.auth.signOut({ scope: 'local' });
export async function register(profile: Partial<User>, kind: 'hq' | 'okrug', password: string) {
  if (!profile.name || profile.name.trim().split(/\s+/).length < 2) throw new AppError('Укажите имя и фамилию.');
  if (!profile.email || !/^\S+@\S+\.\S+$/.test(profile.email)) throw new AppError('Укажите почту — это ваш логин.');
  if (kind === 'okrug' && !profile.districtId) throw new AppError('Выберите свой округ.');
  if (password.length < 8) throw new AppError('Пароль — не короче 8 символов.');
  await B.fnRegister(profile, kind, password);
  await signIn(profile.email, password);
}
export async function bootstrapHead(profile: Partial<User>, password: string) {
  await B.fnBootstrap(profile, password);
  await signIn(profile.email!, password);
}
export async function changePassword(password: string) {
  if (password.length < 8) throw new AppError('Пароль должен быть не короче 8 символов.');
  const { error } = await sb!.auth.updateUser({ password });
  if (error) throw new AppError(B.humanError(error.message));
}

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const name = (s: State, id?: string | null) => s.users.find((u) => u.id === id)?.name ?? '—';

function notify(s: State, actor: User, userIds: (string | null | undefined)[], text: string, link: string, kind: Notification['kind']) {
  const uniq = [...new Set(userIds.filter(Boolean) as string[])].filter((id) => id !== actor.id);
  for (const userId of uniq) s.notifications.unshift({ id: uid('n'), userId, text, at: stamp(), read: false, link, kind });
  s.notifications = s.notifications.slice(0, 400);
}
function audit(s: State, actor: User, entity: string, entityId: string, text: string) {
  s.audit.unshift({ at: stamp(), userId: actor.id, entity, entityId, text });
  s.audit = s.audit.slice(0, 600);
}
function getTask(s: State, id: string) {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) throw new AppError('Задача не найдена — возможно, её удалили или у вас нет к ней доступа.');
  return t;
}
const coordinatorOf = (s: State, districtId: string | null) => s.districts.find((d) => d.id === districtId)?.coordinatorId ?? null;
const taskLink = (t: Task) => `#/tasks/${t.id}`;

/* ───────── Сессия и демо ───────── */
export function switchUser(userId: string) {
  if (!DEMO_MODE) deny();
  state = { ...state, session: { userId } };
  persist();
  emit();
}
export function resetDemo() {
  if (BACKEND) deny('В рабочем режиме сброс данных недоступен.');
  state = ensureReports(createSeed());
  persist();
  emit();
}
export function setUi(patch: Partial<State['ui']>) {
  state = { ...state, ui: { ...state.ui, ...patch } };
  persist();
  emit();
}

/* ───────── Задачи ───────── */
export interface TaskInput {
  title: string;
  description?: string;
  assigneeId: string;
  coAssigneeIds?: string[];
  districtId: string;
  due: string;
  priority: Task['priority'];
  metricId?: string | null;
  eventId?: string | null;
  checklist?: string[];
  links?: string[];
}

export function validateTask(i: Partial<TaskInput>, today = todayISO()) {
  const e: Record<string, string> = {};
  if (!i.title || i.title.trim().length < 3) e.title = 'Введите название — хотя бы 3 символа.';
  if (!i.assigneeId) e.assigneeId = 'Выберите ответственного.';
  if (!i.districtId) e.districtId = 'Выберите округ.';
  if (!i.due) e.due = 'Укажите срок.';
  else if (i.due < today) e.due = 'Срок уже прошёл. Выберите сегодняшнюю или будущую дату.';
  return e;
}

export function createTask(i: TaskInput): string {
  let newId = '';
  mutate((s, me) => {
    if (!P.canCreateTask(me) || !P.canAssignIn(me, i.districtId)) deny('Вы можете ставить задачи только в своём округе.');
    const errs = validateTask(i);
    if (Object.keys(errs).length) throw new AppError(Object.values(errs)[0]);
    const t: Task = {
      id: uid('t'), title: i.title.trim(), description: i.description?.trim() ?? '', assigneeId: i.assigneeId,
      coAssigneeIds: (i.coAssigneeIds ?? []).filter((x) => x !== i.assigneeId), districtId: i.districtId, authorId: me.id,
      due: i.due, priority: i.priority, status: 'new',
      checklist: (i.checklist ?? []).filter((x) => x.trim()).map((text) => ({ id: uid('c'), text: text.trim(), done: false })),
      comments: [], attachments: (i.links ?? []).filter((x) => x.trim()).map((url) => ({ id: uid('a'), name: url, kind: 'link' as const, url })),
      metricId: i.metricId || null, eventId: i.eventId || null, result: null, createdAt: stamp(),
      history: [{ at: stamp(), userId: me.id, text: `Создал(а) задачу и назначил(а) ответственным: ${name(s, i.assigneeId)}` }],
    };
    s.tasks.push(t);
    newId = t.id;
    notify(s, me, [t.assigneeId, ...t.coAssigneeIds], `Новая задача от ${me.name}: «${t.title}», срок ${t.due.split('-').reverse().join('.')}`, taskLink(t), 'assign');
    audit(s, me, 'task', t.id, 'создание');
  });
  return newId;
}

type TaskPatch = Partial<Pick<Task, 'title' | 'description' | 'assigneeId' | 'coAssigneeIds' | 'due' | 'priority' | 'districtId' | 'metricId' | 'eventId'>>;
export function updateTask(id: string, patch: TaskPatch) {
  mutate((s, me) => {
    const t = getTask(s, id);
    if (!P.canEditTask(me, t)) deny('Изменять задачу могут автор, координатор округа и руководители.');
    if (patch.districtId && !P.canAssignIn(me, patch.districtId)) deny('Нельзя перенести задачу в чужой округ.');
    if (patch.title !== undefined && patch.title.trim().length < 3) throw new AppError('Название слишком короткое — минимум 3 символа.');
    const changes: string[] = [];
    if (patch.assigneeId && patch.assigneeId !== t.assigneeId) {
      changes.push(`ответственный: ${name(s, t.assigneeId)} → ${name(s, patch.assigneeId)}`);
      notify(s, me, [patch.assigneeId], `Вас назначили ответственным: «${t.title}»`, taskLink(t), 'assign');
      t.coAssigneeIds = t.coAssigneeIds.filter((x) => x !== patch.assigneeId);
    }
    if (patch.due && patch.due !== t.due) {
      changes.push(`срок: ${t.due.split('-').reverse().join('.')} → ${patch.due.split('-').reverse().join('.')}`);
      notify(s, me, [t.assigneeId, ...t.coAssigneeIds], `Изменён срок задачи «${t.title}»`, taskLink(t), 'deadline');
    }
    if (patch.priority && patch.priority !== t.priority) changes.push(`приоритет: ${PRIORITY_LABEL[t.priority]} → ${PRIORITY_LABEL[patch.priority]}`);
    if (patch.title && patch.title !== t.title) changes.push('название');
    if (patch.description !== undefined && patch.description !== t.description) changes.push('описание');
    if (patch.coAssigneeIds) {
      const added = patch.coAssigneeIds.filter((x) => !t.coAssigneeIds.includes(x));
      if (added.length) notify(s, me, added, `Вы соисполнитель задачи «${t.title}»`, taskLink(t), 'assign');
      changes.push('соисполнители');
    }
    if (patch.districtId && patch.districtId !== t.districtId) changes.push('округ');
    if (patch.metricId !== undefined && patch.metricId !== t.metricId) changes.push('связанный показатель');
    if (patch.eventId !== undefined && patch.eventId !== t.eventId) changes.push('связанное мероприятие');
    Object.assign(t, patch);
    if (patch.coAssigneeIds) t.coAssigneeIds = patch.coAssigneeIds.filter((x) => x !== t.assigneeId);
    if (changes.length) t.history.push({ at: stamp(), userId: me.id, text: `Изменил(а) ${changes.join('; ')}` });
    audit(s, me, 'task', t.id, changes.join('; '));
  });
}

export function setTaskStatus(id: string, status: 'new' | 'in_progress' | 'cancelled', reason?: string) {
  mutate((s, me) => {
    const t = getTask(s, id);
    if (status === 'in_progress' && t.status === 'new') {
      if (!P.canStart(me, t)) deny();
    } else if (status === 'cancelled') {
      if (!P.canEditTask(me, t)) deny('Отменить задачу может автор, координатор округа или руководитель.');
      if (!reason?.trim()) throw new AppError('Укажите причину отмены — она попадёт в историю задачи.');
    } else if (!P.canEditTask(me, t)) deny();
    if (t.status === 'done' || t.status === 'review') {
      if (status !== 'cancelled' || me.role !== 'head') throw new AppError('Задача уже на проверке или выполнена. Чтобы изменить статус, верните её на доработку.');
    }
    const from = t.status;
    t.status = status;
    t.history.push({ at: stamp(), userId: me.id, text: `Статус: ${STATUS_LABEL[from]} → ${STATUS_LABEL[status]}${reason ? `. Причина: ${reason}` : ''}` });
    if (status === 'cancelled') notify(s, me, [t.assigneeId, ...t.coAssigneeIds], `Задача отменена: «${t.title}»`, taskLink(t), 'assign');
    audit(s, me, 'task', t.id, `статус ${status}`);
  });
}

export function submitResult(id: string, r: { text: string; value?: number; attachments: Attachment[] }) {
  mutate((s, me) => {
    const t = getTask(s, id);
    if (!P.canSubmit(me, t)) deny('Сдать результат может только ответственный или соисполнитель задачи.');
    if (r.text.trim().length < 5) throw new AppError('Опишите результат — хотя бы одно короткое предложение.');
    if (t.metricId && (r.value === undefined || isNaN(r.value) || r.value < 0)) throw new AppError('Укажите фактическое значение показателя (число от 0).');
    const res: TaskResult = { text: r.text.trim(), value: t.metricId ? r.value : undefined, attachments: r.attachments, submittedAt: stamp(), submittedDate: todayISO() };
    t.result = res;
    t.status = 'review';
    t.comments.push({ id: uid('m'), authorId: me.id, text: res.text, at: res.submittedAt, kind: 'result' });
    t.history.push({ at: stamp(), userId: me.id, text: 'Отправил(а) результат на проверку' });
    const reviewers = [coordinatorOf(s, t.districtId)];
    if (reviewers[0] === me.id || !reviewers[0]) reviewers.push(...s.users.filter((u) => u.role === 'head').map((u) => u.id));
    notify(s, me, reviewers, `${me.name} отправил(а) результат на проверку: «${t.title}»`, taskLink(t), 'review');
    audit(s, me, 'task', t.id, 'результат отправлен');
  });
}

export function confirmTask(id: string) {
  mutate((s, me) => {
    const t = getTask(s, id);
    if (!P.canReview(me, t)) deny('Подтверждать выполнение может координатор округа или руководитель области, и не по своей задаче.');
    t.status = 'done';
    t.confirmedAt = todayISO();
    t.confirmedBy = me.id;
    t.history.push({ at: stamp(), userId: me.id, text: 'Подтвердил(а) выполнение. Результат учтён в отчёте, показателях и рейтинге.' });
    notify(s, me, [t.assigneeId, ...t.coAssigneeIds], `Результат принят: «${t.title}»`, taskLink(t), 'review');
    audit(s, me, 'task', t.id, 'подтверждено');
  });
}

export function returnTask(id: string, comment: string) {
  mutate((s, me) => {
    const t = getTask(s, id);
    if (!P.canReview(me, t)) deny('Вернуть результат может координатор округа или руководитель области.');
    if (comment.trim().length < 5) throw new AppError('Напишите, что нужно доработать — комментарий обязателен.');
    t.status = 'in_progress';
    t.returnedAt = stamp();
    t.comments.push({ id: uid('m'), authorId: me.id, text: comment.trim(), at: stamp(), kind: 'return' });
    t.history.push({ at: stamp(), userId: me.id, text: 'Вернул(а) на доработку' });
    notify(s, me, [t.assigneeId, ...t.coAssigneeIds], `${me.name} вернул(а) на доработку: «${t.title}»`, taskLink(t), 'review');
    audit(s, me, 'task', t.id, 'возврат');
  });
}

export function addComment(id: string, text: string) {
  mutate((s, me) => {
    const t = getTask(s, id);
    if (!P.canComment(me, t)) deny();
    if (!text.trim()) throw new AppError('Комментарий пустой.');
    t.comments.push({ id: uid('m'), authorId: me.id, text: text.trim(), at: stamp(), kind: 'comment' });
    notify(s, me, [t.assigneeId, t.authorId, ...t.coAssigneeIds], `${me.name} прокомментировал(а) «${t.title}»`, taskLink(t), 'comment');
  });
}

export function toggleCheck(id: string, itemId: string) {
  mutate((s, me) => {
    const t = getTask(s, id);
    if (!(P.canEditTask(me, t) || P.isInvolved(me, t))) deny();
    const c = t.checklist.find((x) => x.id === itemId);
    if (c) c.done = !c.done;
  });
}
export function addCheck(id: string, text: string) {
  mutate((s, me) => {
    const t = getTask(s, id);
    if (!(P.canEditTask(me, t) || P.isInvolved(me, t))) deny();
    if (!text.trim()) throw new AppError('Пункт чек-листа пустой.');
    t.checklist.push({ id: uid('c'), text: text.trim(), done: false });
  });
}
export function addAttachment(id: string, a: Attachment) {
  mutate((s, me) => {
    const t = getTask(s, id);
    if (!(P.canEditTask(me, t) || P.isInvolved(me, t))) deny();
    t.attachments.push(a);
    t.history.push({ at: stamp(), userId: me.id, text: `Добавил(а) вложение: ${a.name}` });
  });
}

/* ───────── Мероприятия ───────── */
export type EventInput = Omit<CalEvent, 'id' | 'history' | 'cancelled'> & { taskIds?: string[] };
export function validateEvent(e: Partial<EventInput>) {
  const errs: Record<string, string> = {};
  if (!e.title || e.title.trim().length < 3) errs.title = 'Введите название мероприятия.';
  if (!e.start) errs.start = 'Укажите дату и время начала.';
  if (e.start && e.end && e.end <= e.start) errs.end = 'Окончание должно быть позже начала.';
  if (!e.place?.trim() && !e.link?.trim()) errs.place = 'Укажите место или ссылку на онлайн-встречу.';
  return errs;
}
export function saveEvent(input: EventInput, id?: string): string {
  let eid = id ?? '';
  mutate((s, me) => {
    const errs = validateEvent(input);
    if (Object.keys(errs).length) throw new AppError(Object.values(errs)[0]);
    const { taskIds, ...data } = input;
    if (id) {
      const e = s.events.find((x) => x.id === id);
      if (!e) throw new AppError('Мероприятие не найдено.');
      if (!P.canEditEvent(me, e)) deny('Изменять мероприятие могут ответственный, координатор округа и штаб.');
      const timeChanged = e.start !== data.start || e.place !== data.place || e.link !== data.link;
      Object.assign(e, data);
      e.history.push({ at: stamp(), userId: me.id, text: timeChanged ? 'Изменил(а) время или место' : 'Обновил(а) мероприятие' });
      notify(s, me, [e.ownerId, ...e.participantIds], `Изменения в мероприятии «${e.title}»${timeChanged ? ': новое время или место' : ''}`, `#/calendar/${e.id}`, 'event');
    } else {
      if (!P.canCreateEvent(me)) deny('Создавать мероприятия могут координаторы, штаб и руководители.');
      if (me.role === 'coordinator' && data.districtId !== me.districtId) deny('Координатор создаёт мероприятия только для своего округа.');
      const e: CalEvent = { ...data, id: uid('e'), history: [{ at: stamp(), userId: me.id, text: 'Создал(а) мероприятие' }] };
      s.events.push(e);
      eid = e.id;
      notify(s, me, [e.ownerId, ...e.participantIds], `Новое мероприятие: «${e.title}», ${e.start.slice(8, 10)}.${e.start.slice(5, 7)} в ${e.start.slice(11)}`, `#/calendar/${e.id}`, 'event');
    }
    if (taskIds) {
      s.tasks.forEach((t) => {
        if (taskIds.includes(t.id)) t.eventId = eid;
        else if (t.eventId === eid) t.eventId = null;
      });
    }
    audit(s, me, 'event', eid, id ? 'изменение' : 'создание');
  });
  return eid;
}
export function cancelEvent(id: string) {
  mutate((s, me) => {
    const e = s.events.find((x) => x.id === id);
    if (!e) throw new AppError('Мероприятие не найдено.');
    if (!P.canEditEvent(me, e)) deny();
    e.cancelled = true;
    e.history.push({ at: stamp(), userId: me.id, text: 'Отменил(а) мероприятие' });
    notify(s, me, [e.ownerId, ...e.participantIds], `Мероприятие отменено: «${e.title}»`, `#/calendar/${e.id}`, 'event');
  });
}

/* ───────── Отчёты ───────── */
export function saveReport(id: string, patch: Pick<Report, 'conclusions' | 'problems' | 'plan'>) {
  mutate((s, me) => {
    const r = s.reports.find((x) => x.id === id)!;
    if (!P.canEditReport(me, r)) deny('Редактировать отчёт может координатор округа, пока отчёт не отправлен.');
    Object.assign(r, patch);
    r.updatedAt = stamp();
  });
}
export function sendReport(id: string) {
  mutate((s, me) => {
    const r = s.reports.find((x) => x.id === id)!;
    if (!P.canEditReport(me, r)) deny();
    if (!r.conclusions.trim()) throw new AppError('Заполните поле «Выводы» — без него отчёт нельзя отправить.');
    r.status = 'sent';
    r.updatedAt = stamp();
    r.history.push({ at: stamp(), userId: me.id, text: 'Отправил(а) отчёт на проверку' });
    notify(s, me, s.users.filter((u) => u.role === 'head').map((u) => u.id), `Отчёт округа ${s.districts.find((d) => d.id === r.districtId)?.name} отправлен на проверку`, `#/reports/${r.id}`, 'report');
  });
}
export function reviewReport(id: string, accept: boolean, comment = '') {
  mutate((s, me) => {
    const r = s.reports.find((x) => x.id === id)!;
    if (!P.canReviewReport(me, r)) deny('Принимать отчёты может руководитель области.');
    if (!accept && comment.trim().length < 5) throw new AppError('Напишите, что нужно исправить в отчёте.');
    r.status = accept ? 'accepted' : 'returned';
    r.returnComment = accept ? undefined : comment.trim();
    r.updatedAt = stamp();
    r.history.push({ at: stamp(), userId: me.id, text: accept ? 'Принял(а) отчёт' : `Вернул(а) отчёт: ${comment.trim()}` });
    notify(s, me, [coordinatorOf(s, r.districtId)], accept ? 'Отчёт принят' : 'Отчёт возвращён на доработку', `#/reports/${r.id}`, 'report');
  });
}

/* ───────── Профиль, настройки ───────── */
export function updateUser(id: string, patch: Partial<User>) {
  mutate((s, me) => {
    const u = s.users.find((x) => x.id === id)!;
    if (!P.canEditUser(me, u)) deny('Изменять чужой профиль может только руководитель.');
    if (patch.role && me.role !== 'head') deny('Роль меняет руководитель области.');
    if (patch.name !== undefined && patch.name.trim().length < 3) throw new AppError('Укажите имя и фамилию.');
    if (patch.email !== undefined && patch.email && !/^\S+@\S+\.\S+$/.test(patch.email)) throw new AppError('Проверьте адрес почты: пример — name@example.ru');
    Object.assign(u, patch);
    audit(s, me, 'user', u.id, 'изменение профиля');
  });
}
export function updateWeights(w: Weights) {
  mutate((s, me) => {
    if (!P.canEditWeights(me)) deny('Настраивать веса может руководитель области.');
    s.weights = w;
    audit(s, me, 'settings', 'weights', 'изменены веса рейтинга');
  });
}
export function updateMetric(id: string, patch: { monthlyPlan?: number; weight?: number; districtPlans?: Record<string, number> }) {
  mutate((s, me) => {
    if (!P.canEditWeights(me)) deny();
    Object.assign(s.metrics.find((m) => m.id === id)!, patch);
    audit(s, me, 'metric', id, patch.districtPlans ? 'изменён план по округам' : 'изменён план или вес');
  });
}
export function markRead(ids?: string[]) {
  mutate((s, me) => {
    s.notifications.forEach((n) => {
      if (n.userId === me.id && (!ids || ids.includes(n.id))) n.read = true;
    });
  });
}

/* ───────── Импорт ───────── */
function importPeopleLocal(rows: Partial<User>[], mode: 'skip' | 'update') {
  let added = 0, updated = 0;
  mutate((s, me) => {
    if (!P.canImport(me)) deny();
    for (const r of rows) {
      const dup = s.users.find((u) => (r.email && u.email.toLowerCase() === r.email.toLowerCase()) || (r.phone && u.phone.replace(/\D/g, '') === r.phone.replace(/\D/g, '')));
      if (me.role === 'coordinator' && r.districtId !== me.districtId) continue;
      if (dup) {
        if (mode === 'update') { Object.assign(dup, Object.fromEntries(Object.entries(r).filter(([, v]) => v))); updated++; }
        continue;
      }
      s.users.push({ id: uid('u'), name: r.name!, role: r.role ?? 'member', position: r.position ?? '', districtId: r.districtId ?? null, email: r.email ?? '', phone: r.phone ?? '', telegram: r.telegram, birthday: r.birthday, birthdayVisibility: 'district', active: true });
      added++;
    }
    audit(s, me, 'import', 'users', `импорт людей: +${added}, обновлено ${updated}`);
  });
  return { added, updated };
}
export function importTasks(rows: TaskInput[], mode: 'skip' | 'update') {
  let added = 0, updated = 0;
  mutate((s, me) => {
    if (!P.canImport(me)) deny();
    for (const r of rows) {
      if (!P.canAssignIn(me, r.districtId)) continue;
      const dup = s.tasks.find((t) => t.title.trim().toLowerCase() === r.title.trim().toLowerCase() && t.districtId === r.districtId && t.due === r.due);
      if (dup) {
        if (mode === 'update') { Object.assign(dup, { assigneeId: r.assigneeId, priority: r.priority, description: r.description || dup.description }); updated++; }
        continue;
      }
      s.tasks.push({
        id: uid('t'), title: r.title, description: r.description ?? '', assigneeId: r.assigneeId, coAssigneeIds: [], districtId: r.districtId, authorId: me.id,
        due: r.due, priority: r.priority, status: 'new', checklist: [], comments: [], attachments: [], metricId: r.metricId ?? null, eventId: null, result: null, createdAt: stamp(),
        history: [{ at: stamp(), userId: me.id, text: 'Импортировал(а) из таблицы' }],
      });
      added++;
    }
    audit(s, me, 'import', 'tasks', `импорт задач: +${added}, обновлено ${updated}`);
  });
  return { added, updated };
}

export interface Credential { name: string; email: string; password: string }
export async function importPeople(rows: Partial<User>[], mode: 'skip' | 'update'): Promise<{ added: number; updated: number; credentials: Credential[] }> {
  if (!BACKEND) return { ...importPeopleLocal(rows, mode), credentials: [] };
  let added = 0, updated = 0;
  const credentials: Credential[] = [];
  const errors: string[] = [];
  for (const r of rows) {
    const dup = state.users.find((u) => r.email && u.email.toLowerCase() === r.email.toLowerCase());
    if (dup) {
      if (mode === 'update' && P.canEditUser(me(), dup)) { updateUser(dup.id, Object.fromEntries(Object.entries(r).filter(([k, v]) => v && k !== 'role' && k !== 'districtId'))); updated++; }
      continue;
    }
    try {
      const res = await addPerson(r);
      credentials.push({ name: r.name!, email: r.email!, password: res.password });
      added++;
    } catch (e) {
      errors.push(`${r.name}: ${(e as Error).message}`);
    }
  }
  if (errors.length) saveError?.(`Не добавлены: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` и ещё ${errors.length - 3}` : ''}`);
  return { added, updated, credentials };
}

/* ───────── Команда: учётные записи и округа ───────── */
const me = () => state.users.find((u) => u.id === state.session.userId)!;
export function canAddPerson(u: User) { return u.role === 'head' || u.role === 'coordinator'; }

/** Добавить сотрудника. В рабочем режиме создаётся учётная запись и выдаётся временный пароль. */
export async function addPerson(p: Partial<User>): Promise<{ id: string; password: string }> {
  const actor = me();
  if (!(actor.role === 'head' || (actor.role === 'coordinator' && p.role === 'member' && p.districtId === actor.districtId)))
    deny('Добавлять людей может руководитель области; координатор — только участников своего округа.');
  if (!p.name || p.name.trim().split(/\s+/).length < 2) throw new AppError('Укажите имя и фамилию.');
  if (!p.email || !/^\S+@\S+\.\S+$/.test(p.email)) throw new AppError('Укажите рабочую почту — по ней сотрудник будет входить.');
  if ((p.role === 'member' || p.role === 'coordinator') && !p.districtId) throw new AppError('Выберите округ.');
  if (state.users.some((u) => u.email.toLowerCase() === p.email!.toLowerCase())) throw new AppError(`Сотрудник с почтой ${p.email} уже есть.`);
  if (BACKEND) {
    const r = await B.fnCreateUser(p);
    applyRemote('profiles', r.profile);
    return { id: r.id, password: r.password };
  }
  const id = uid('u');
  mutate((s) => {
    s.users.push({ id, name: p.name!.trim(), role: p.role ?? 'member', title: p.title ?? null, position: p.position ?? '', districtId: p.districtId ?? null, email: p.email!, phone: p.phone ?? '', telegram: p.telegram, birthdayVisibility: 'district', active: true });
    const d = s.districts.find((x) => x.id === p.districtId);
    if (p.role === 'coordinator' && d && !d.coordinatorId) d.coordinatorId = id;
  });
  return { id, password: 'демо-пароль' };
}
export async function resetPassword(userId: string) {
  if (!BACKEND) return 'демо-пароль';
  return (await B.fnResetPassword(userId)).password;
}

/** Роль, округ и активность — меняет руководитель области. */
export function setUserAdmin(id: string, patch: Partial<Pick<User, 'role' | 'title' | 'districtId' | 'active' | 'position' | 'pending'>>) {
  mutate((s, actor) => {
    const target = s.users.find((x) => x.id === id)!;
    if (!P.canManageUser(actor, target)) deny('Роль и доступ меняют руководство области, а для участников своего округа — координатор.');
    if (actor.role !== 'head' && ((patch.role && patch.role !== 'member') || (patch.districtId !== undefined && patch.districtId !== target.districtId) || (patch.title && !['member', 'party_member'].includes(patch.title))))
      deny('Координатор может сделать человека участником или членом партии своего округа. Другие роли назначает руководство области.');
    if (id === actor.id && (patch.role && patch.role !== 'head' || patch.active === false)) throw new AppError('Нельзя снять с себя роль руководителя или отключить себя — попросите другого руководителя.');
    const u = s.users.find((x) => x.id === id)!;
    Object.assign(u, patch);
    if ((u.role === 'member' || u.role === 'coordinator') && !u.districtId) throw new AppError('Для координатора и участника нужен округ.');
    if (u.role === 'head' || u.role === 'staff') u.districtId = patch.districtId ?? u.districtId;
    s.districts.forEach((d) => {
      if (d.coordinatorId === id && (u.role !== 'coordinator' || u.districtId !== d.id || !u.active)) d.coordinatorId = null;
      if (u.role === 'coordinator' && u.title !== 'deputy_coordinator' && u.active && u.districtId === d.id && !d.coordinatorId) d.coordinatorId = id;
    });
  });
}

export function addDistrict(name: string) {
  mutate((s, actor) => {
    if (actor.role !== 'head') deny('Добавлять округа может руководитель области.');
    const n = name.trim();
    if (n.length < 2) throw new AppError('Введите название округа.');
    if (s.districts.some((d) => d.name.toLowerCase() === n.toLowerCase())) throw new AppError('Такой округ уже есть.');
    s.districts.push({ id: `d_${Date.now().toString(36)}`, name: n, coordinatorId: null });
    s.districts.sort((a, b) => (a.num ?? 999) - (b.num ?? 999) || a.name.localeCompare(b.name, 'ru'));
    ensureReports(s);
  });
}
export function renameDistrict(id: string, name: string) {
  mutate((s, actor) => {
    if (actor.role !== 'head') deny();
    if (name.trim().length < 2) throw new AppError('Введите название округа.');
    s.districts.find((d) => d.id === id)!.name = name.trim();
  });
}

/* ───────── Telegram ───────── */
export async function connectTelegram() {
  if (!BACKEND) throw new AppError('В деморежиме Telegram не подключается.');
  const bot = state.extras?.telegramBot;
  if (!bot) throw new AppError('Бот ещё не подключён руководителем. Попросите его подключить бота в настройках.');
  const code = await B.createTelegramCode(state.session.userId);
  return `https://t.me/${bot}?start=${code}`;
}
export async function disconnectTelegram() {
  await B.unlinkTelegram(state.session.userId);
  state = { ...state, extras: { ...state.extras, telegramLinked: false } };
  emit();
}
export async function setupBot() {
  if (!BACKEND) throw new AppError('В деморежиме Telegram не подключается.');
  const appUrl = `${location.origin}${location.pathname}`;
  const r = await B.fnSetupBot(appUrl);
  state = { ...state, extras: { ...state.extras, telegramBot: r.username } };
  emit();
  return r.username;
}

/* ───────── Ежедневный отчёт ───────── */
export function saveDaily(input: { day: string; done: string; plan: string; problems: string }) {
  mutate((s, me) => {
    if (me.role === 'member') deny('Ежедневный отчёт заполняют штаб, координаторы и заместители.');
    if (input.done.trim().length < 10) throw new AppError('Опишите, что сделано за день — хотя бы одно предложение.');
    if (input.day > todayISO()) throw new AppError('Нельзя заполнить отчёт за будущий день.');
    if (input.day < addDays(todayISO(), -2)) throw new AppError('Отчёт старше двух дней закрыт для изменений.');
    const id = `dr_${me.id}_${input.day}`;
    const doc = { id, userId: me.id, day: input.day, done: input.done.trim(), plan: input.plan.trim(), problems: input.problems.trim(), updatedAt: stamp() };
    const i = s.dailyReports.findIndex((r) => r.userId === me.id && r.day === input.day);
    if (i >= 0) s.dailyReports[i] = { ...s.dailyReports[i], ...doc, id: s.dailyReports[i].id }; else s.dailyReports.push(doc);
  });
}

export const defaultEventStart = () => `${addDays(todayISO(), 1)}T12:00`;
export { nowMsk };
