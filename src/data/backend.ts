// Синхронизация состояния приложения с Supabase.
// Локальное состояние меняется сразу (как в демо), затем изменённые документы отправляются в базу,
// где их заново проверяют RLS и триггеры. Ответ сервера (с серверными полями) возвращается в состояние.
import { sb, FUNCTIONS_URL } from '../lib/supabase';
import type { AuditItem, Brief, CalEvent, DailyReport, District, Metric, Notification, PdPlan, Report, State, Task, User, Weights } from './types';

type Table = 'tasks' | 'events' | 'reports' | 'districts' | 'metrics' | 'profiles' | 'notifications' | 'daily_reports' | 'media_briefs';
export type Collection = 'tasks' | 'events' | 'reports' | 'districts' | 'metrics' | 'users' | 'notifications' | 'dailyReports' | 'briefs';
export const TABLE_OF: Record<Collection, Table> = { tasks: 'tasks', events: 'events', reports: 'reports', districts: 'districts', metrics: 'metrics', users: 'profiles', notifications: 'notifications', dailyReports: 'daily_reports', briefs: 'media_briefs' };
export const COLLECTION_OF: Record<string, Collection> = Object.fromEntries(Object.entries(TABLE_OF).map(([c, t]) => [t, c])) as Record<string, Collection>;

const RLS_MSG = 'Недостаточно прав для этого действия. Обратитесь к координатору или руководителю.';
export function humanError(message: string) {
  if (/row-level security|permission denied/i.test(message)) return RLS_MSG;
  if (/Failed to fetch|NetworkError|network/i.test(message)) return 'Нет связи с сервером. Проверьте интернет — изменение не сохранено.';
  if (/JWT|token/i.test(message)) return 'Сессия истекла. Обновите страницу и войдите снова.';
  return message;
}

export async function loadAll(uid: string): Promise<Partial<State> & { telegramBot?: string; telegramLinked: boolean }> {
  const db = sb!;
  const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const [p, d, m, t, e, r, n, s, tl, dr, br] = await Promise.all([
    db.from('profiles').select('data'),
    db.from('districts').select('data'),
    db.from('metrics').select('data'),
    db.from('tasks').select('data'),
    db.from('events').select('data'),
    db.from('reports').select('data'),
    db.from('notifications').select('data').eq('user_id', uid).order('created_at', { ascending: false }).limit(200),
    db.from('settings').select('key, value'),
    db.from('telegram_links').select('user_id').eq('user_id', uid),
    db.from('daily_reports').select('data').gte('day', since),
    db.from('media_briefs').select('data').order('created_at', { ascending: false }).limit(60),
  ]);
  const err = [p, d, m, t, e, r, n, s, dr, br].find((x) => x.error)?.error;
  if (err) throw new Error(humanError(err.message));
  const settings = Object.fromEntries((s.data ?? []).map((x) => [x.key, x.value]));
  const pick = <T,>(res: { data: { data: unknown }[] | null }) => (res.data ?? []).map((x) => x.data as T);
  return {
    users: pick<User>(p),
    districts: pick<District>(d).sort((a, b) => (a.num ?? 999) - (b.num ?? 999) || a.name.localeCompare(b.name, 'ru')),
    metrics: pick<Metric>(m),
    tasks: pick<Task>(t),
    events: pick<CalEvent>(e),
    reports: pick<Report>(r),
    dailyReports: pick<DailyReport>(dr),
    briefs: pick<Brief>(br),
    pdPlan: settings.pd_plan as PdPlan | undefined,
    notifications: pick<Notification>(n),
    weights: settings.weights as Weights,
    telegramBot: settings.telegram?.username,
    telegramLinked: (tl.data ?? []).length > 0,
  };
}

export async function loadAudit(): Promise<AuditItem[]> {
  const { data } = await sb!.from('audit_log').select('at, user_id, entity, entity_id, action').order('at', { ascending: false }).limit(60);
  const ACT: Record<string, string> = { insert: 'создание', update: 'изменение', delete: 'удаление' };
  return (data ?? []).map((a) => ({ at: a.at, userId: a.user_id, entity: a.entity, entityId: a.entity_id, text: ACT[a.action] ?? a.action }));
}

interface Change { table: Table; op: 'insert' | 'update'; id: string; data: unknown; userId?: string }

/** Что изменилось между двумя состояниями — только документы, которые реально отличаются. */
export function diff(prev: State, next: State, uid: string): { changes: Change[]; weights?: Weights; pdPlan?: PdPlan } {
  const changes: Change[] = [];
  (Object.keys(TABLE_OF) as Collection[]).forEach((c) => {
    const before = new Map((prev[c] as { id: string }[]).map((x) => [x.id, JSON.stringify(x)]));
    for (const item of next[c] as { id: string; userId?: string }[]) {
      const old = before.get(item.id);
      const now = JSON.stringify(item);
      if (old === now) continue;
      if (c === 'users' && old === undefined) continue; // люди создаются через функцию team-admin
      if (c === 'notifications' && old !== undefined && item.userId !== uid) continue;
      changes.push({ table: TABLE_OF[c], op: old === undefined ? 'insert' : 'update', id: item.id, data: item, userId: item.userId });
    }
  });
  const weights = JSON.stringify(prev.weights) !== JSON.stringify(next.weights) ? next.weights : undefined;
  const pdPlan = next.pdPlan && JSON.stringify(prev.pdPlan) !== JSON.stringify(next.pdPlan) ? next.pdPlan : undefined;
  return { changes, weights, pdPlan };
}

/** Отправить изменения по очереди. Возвращает документы в серверной версии. */
export async function push(changes: Change[], weights?: Weights, pdPlan?: PdPlan) {
  const db = sb!;
  const saved: { table: Table; data: unknown }[] = [];
  for (const ch of changes) {
    if (ch.table === 'notifications') {
      const row = { id: ch.id, user_id: ch.userId, data: ch.data };
      const { error } = ch.op === 'insert' ? await db.from('notifications').insert(row) : await db.from('notifications').update({ data: ch.data }).eq('id', ch.id);
      if (error && !/duplicate/.test(error.message)) throw new Error(humanError(error.message));
      continue;
    }
    const q = ch.op === 'insert'
      ? db.from(ch.table).insert({ id: ch.id, data: ch.data }).select('data')
      : db.from(ch.table).update({ data: ch.data }).eq('id', ch.id).select('data');
    const { data, error } = await q;
    if (error) throw new Error(humanError(error.message));
    if (!data?.length) throw new Error(RLS_MSG);
    saved.push({ table: ch.table, data: data[0].data });
  }
  if (weights) {
    const { error } = await db.from('settings').upsert({ key: 'weights', value: weights });
    if (error) throw new Error(humanError(error.message));
  }
  if (pdPlan) {
    const { error } = await db.from('settings').upsert({ key: 'pd_plan', value: pdPlan });
    if (error) throw new Error(humanError(error.message));
  }
  return saved;
}

/* ───────── Серверные функции ───────── */
async function callFn<T>(name: string, body: unknown): Promise<T> {
  const { data: s } = await sb!.auth.getSession();
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ?? `Ошибка сервера (${res.status})`);
  return json as T;
}
export const fnCreateUser = (profile: Partial<User>) => callFn<{ id: string; profile: User; password: string }>('team-admin', { action: 'create_user', profile });
export const fnResetPassword = (userId: string) => callFn<{ password: string }>('team-admin', { action: 'reset_password', userId });
export const fnBootstrap = (profile: Partial<User>, password: string) => callFn<{ ok: true }>('team-admin', { action: 'bootstrap', profile, password });
export const fnRegister = (profile: Partial<User>, kind: 'hq' | 'okrug', password: string) => callFn<{ ok: true }>('team-admin', { action: 'register', profile, kind, password });
export async function myStatus(): Promise<{ exists: boolean; active?: boolean; pending?: boolean; name?: string }> {
  const { data } = await sb!.rpc('my_status');
  return (data as { exists: boolean }) ?? { exists: false };
}
export const fnSetupBot = (appUrl: string) => callFn<{ username: string }>('telegram', { action: 'setup', appUrl });

export async function createTelegramCode(uid: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const code = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { error } = await sb!.from('telegram_link_codes').insert({ code, user_id: uid });
  if (error) throw new Error(humanError(error.message));
  return code;
}
export async function unlinkTelegram(uid: string) {
  const { error } = await sb!.from('telegram_links').delete().eq('user_id', uid);
  if (error) throw new Error(humanError(error.message));
}

/* ───────── Файлы ───────── */
export const STORAGE_PREFIX = 'sb://attachments/';
export async function uploadFile(uid: string, file: Blob, name: string) {
  // Хранилище принимает только латиницу в ключах; исходное имя файла хранится во вложении
  const ext = (name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();
  const base = name.slice(0, name.length - ext.length).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 60);
  const path = `${uid}/${crypto.randomUUID()}${base ? '-' + base : ''}${ext}`;
  const { error } = await sb!.storage.from('attachments').upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(/exceeded|too large/i.test(error.message) ? 'Файл больше 10 МБ — приложите его ссылкой на облако.' : humanError(error.message));
  return STORAGE_PREFIX + path;
}
const signed = new Map<string, { url: string; until: number }>();
export async function signedUrl(ref: string) {
  const hit = signed.get(ref);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await sb!.storage.from('attachments').createSignedUrl(ref.slice(STORAGE_PREFIX.length), 3600);
  if (error || !data) return '';
  signed.set(ref, { url: data.signedUrl, until: Date.now() + 50 * 60e3 });
  return data.signedUrl;
}
