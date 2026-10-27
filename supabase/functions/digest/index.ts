// Сводки и напоминания по расписанию (pg_cron → call_digest → эта функция с x-hook-secret).
//  • weekly    — понедельник 10:00 МСК: руководству — по области, координаторам и заместителям — по своему округу.
//  • pd_remind — будни 12:00 МСК: напоминание написать пост тем, кто не писал в «Пиши-Делись» 3+ дня.
// Уведомления пишутся в таблицу notifications — дальше их разносит триггер notify_telegram.
// { dry: true } — вернуть тексты без отправки (для проверки).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' });
const today = () => dayFmt.format(new Date());
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d: string) => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0 = пн
const ddmm = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`;
/** Ключ ФИО для сопоставления с таблицей «Пиши-Делись»: фамилия + имя без учёта порядка, регистра и ё */
const nameKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).sort().join(' ');
const plural = (n: number, f: [string, string, string]) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; };
const delta = (a: number, b: number) => (a === b ? '=' : a > b ? `↑${a - b}` : `↓${b - a}`);

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Pd { people: [string, string][]; posts: any[][] } // eslint-disable-line @typescript-eslint/no-explicit-any

async function secret(key: string) {
  const { data } = await admin.from('app_secrets').select('value').eq('key', key).single();
  return data?.value as string | undefined;
}
async function loadPd(): Promise<Pd | null> {
  try { const r = await fetch(`${URL_}/functions/v1/media-pd`); const d = await r.json(); return d.error ? null : d; } catch { return null; }
}
const rows = async (t: string) => ((await admin.from(t).select('data')).data ?? []).map((x) => x.data as Doc);

async function send(items: { userId: string; id: string; text: string; link: string; kind: string }[], dry: boolean) {
  if (dry || !items.length) return;
  await admin.from('notifications').upsert(items.map((n) => ({ id: n.id, user_id: n.userId, data: { id: n.id, userId: n.userId, text: n.text, at: new Date().toISOString(), read: false, link: n.link, kind: n.kind } })), { onConflict: 'id', ignoreDuplicates: true });
}

async function weekly(dry: boolean) {
  const [profiles, districts, tasks, daily, pd] = await Promise.all([rows('profiles'), rows('districts'), rows('tasks'), rows('daily_reports'), loadPd()]);
  const t = today();
  const wFrom = addDays(t, -7 - weekday(t)), wTo = addDays(wFrom, 6); // прошлая неделя пн–вс
  const pFrom = addDays(wFrom, -7), pTo = addDays(wFrom, -1);
  const active = profiles.filter((p) => p.active !== false && !p.pending);
  const reqTitles = ['staff', 'media', 'coordinator', 'deputy_coordinator', 'deputy'];
  const workdays = Array.from({ length: 5 }, (_, k) => addDays(wFrom, k));
  const pdAsOf = pd?.posts.reduce((m, p) => (p[0] > m ? p[0] : m), '') ?? '';
  const pdFresh = pdAsOf >= wTo;
  const dname = (id: string) => { const d = districts.find((x) => x.id === id); return d ? `${d.num ?? ''} ${d.name}`.trim() : id; };

  const stat = (did: string | null) => {
    const inD = (x: Doc) => !did || x.districtId === did;
    const done = (a: string, b: string) => tasks.filter((x) => inD(x) && x.status === 'done' && x.confirmedAt >= a && x.confirmedAt <= b).length;
    const overdue = tasks.filter((x) => inD(x) && (x.status === 'new' || x.status === 'in_progress') && x.due < t);
    const req = active.filter((p) => (!did || p.districtId === did) && reqTitles.includes(p.title ?? p.role));
    const missing = req.map((p) => ({ p, n: workdays.filter((d) => !daily.some((r) => r.userId === p.id && r.day === d)).length })).filter((x) => x.n >= 3);
    const posts = (a: string, b: string) => (pd ? pd.posts.filter((p) => p[0] >= a && p[0] <= b && (!did || pd.people[p[4]]?.[1] === did)).length : 0);
    const problems = daily.filter((r) => r.day >= wFrom && r.day <= wTo && (r.problems ?? '').trim() && (!did || profiles.find((p) => p.id === r.userId)?.districtId === did)).length;
    return { doneW: done(wFrom, wTo), doneP: done(pFrom, pTo), overdue, req, missing, postsW: posts(wFrom, wTo), postsP: posts(pFrom, pTo), problems };
  };
  // кто из списка округа не писал 2 недели — только если таблица свежая
  const silent = (did: string) => {
    if (!pd || !pdFresh) return [] as string[];
    const from = addDays(wTo, -13);
    const wrote = new Set(pd.posts.filter((p) => p[0] >= from).map((p) => p[4]));
    return pd.people.map((p, i) => ({ name: p[0], g: p[1], i })).filter((p) => p.g === did && !wrote.has(p.i)).map((p) => p.name);
  };
  const pdLine = (s: ReturnType<typeof stat>) => (pd ? (pdFresh ? `Посты «Пиши-Делись»: ${s.postsW} (${delta(s.postsW, s.postsP)} к пред. неделе)` : `«Пиши-Делись»: таблица не обновлялась с ${ddmm(pdAsOf)}`) : '«Пиши-Делись»: данные недоступны');

  const out: { userId: string; id: string; text: string; link: string; kind: string }[] = [];
  const head = `Сводка за неделю ${ddmm(wFrom)}–${ddmm(wTo)}`;

  // Руководство: по области + лучшие/худшие округа
  const all = stat(null);
  const per = districts.map((d) => ({ d, s: stat(d.id) }));
  const byTasks = [...per].sort((a, b) => (b.s.doneW - b.s.doneP) - (a.s.doneW - a.s.doneP));
  const lines = [
    `📊 ${head} · вся область`,
    `Задачи подтверждены: ${all.doneW} (${delta(all.doneW, all.doneP)})`,
    `Просрочено сейчас: ${all.overdue.length}`,
    pdLine(all),
    `Отчёты дня: не сдают ${all.missing.length} из ${all.req.length}${all.problems ? ` · с проблемами ${all.problems}` : ''}`,
    '',
    `Рост: ${byTasks.slice(0, 2).filter((x) => x.s.doneW > x.s.doneP).map((x) => `${dname(x.d.id)} (${delta(x.s.doneW, x.s.doneP)})`).join(', ') || 'нет'}`,
    `Спад: ${byTasks.slice(-2).reverse().filter((x) => x.s.doneW < x.s.doneP).map((x) => `${dname(x.d.id)} (${delta(x.s.doneW, x.s.doneP)})`).join(', ') || 'нет'}`,
    `Больше всего просрочек: ${[...per].sort((a, b) => b.s.overdue.length - a.s.overdue.length).filter((x) => x.s.overdue.length).slice(0, 3).map((x) => `${dname(x.d.id)} — ${x.s.overdue.length}`).join(', ') || 'нет'}`,
  ];
  active.filter((p) => p.role === 'head').forEach((p) => out.push({ userId: p.id, id: `wd_${wFrom}_${p.id.slice(0, 8)}`, text: lines.join('\n'), link: '#/pulse', kind: 'report' }));

  // Координаторы и заместители: свой округ
  per.forEach(({ d, s }) => {
    const sil = silent(d.id);
    const ov = [...new Set(s.overdue.map((x) => profiles.find((p) => p.id === x.assigneeId)?.name).filter(Boolean))];
    const text = [
      `📊 ${head} · ${dname(d.id)}`,
      `Задачи подтверждены: ${s.doneW} (${delta(s.doneW, s.doneP)})`,
      `Просрочено сейчас: ${s.overdue.length}${ov.length ? ` — ${ov.slice(0, 5).join(', ')}` : ''}`,
      pdLine(s),
      sil.length ? `Не писали 2 недели: ${sil.slice(0, 8).join(', ')}${sil.length > 8 ? ` и ещё ${sil.length - 8}` : ''}` : '',
      s.missing.length ? `Не сдают отчёт дня: ${s.missing.map((x) => x.p.name).join(', ')}` : 'Отчёты дня сдают все',
    ].filter(Boolean).join('\n');
    active.filter((p) => p.role === 'coordinator' && p.districtId === d.id).forEach((p) => out.push({ userId: p.id, id: `wd_${wFrom}_${p.id.slice(0, 8)}`, text, link: `#/team/districts/${d.id}`, kind: 'report' }));
  });
  await send(out, dry);
  return { sent: dry ? 0 : out.length, preview: dry ? out.map((x) => x.text) : undefined };
}

async function pdRemind(dry: boolean) {
  const [profiles, pd] = await Promise.all([rows('profiles'), loadPd()]);
  if (!pd) return { skipped: 'нет данных «Пиши-Делись»' };
  const t = today();
  const asOf = pd.posts.reduce((m, p) => (p[0] > m ? p[0] : m), '');
  // таблица давно не обновлялась — напоминания были бы ложными
  if (asOf < addDays(t, -2)) return { skipped: `таблица не обновлялась с ${asOf}` };
  const last = new Map<number, string>();
  pd.posts.forEach((p) => { if ((last.get(p[4]) ?? '') < p[0]) last.set(p[4], p[0]); });
  const byKey = new Map(pd.people.map((p, i) => [nameKey(p[0]), i]));
  const out: { userId: string; id: string; text: string; link: string; kind: string }[] = [];
  for (const p of profiles) {
    if (p.active === false || p.pending) continue;
    const i = byKey.get(nameKey(p.name ?? ''));
    if (i === undefined) continue; // человека нет в списках «Пиши-Делись»
    const l = last.get(i);
    const days = l ? Math.round((Date.parse(t) - Date.parse(l)) / 864e5) : 99;
    if (days < 3) continue;
    // не чаще раза в 3 дня: id привязан к трёхдневному окну
    const slot = Math.floor(Date.parse(t) / (3 * 864e5));
    out.push({ userId: p.id, id: `pd_${slot}_${p.id.slice(0, 8)}`, link: '#/media/brief', kind: 'media',
      text: l ? `Вы не публиковали пост ${days} ${plural(days, ['день', 'дня', 'дней'])} (последний — ${ddmm(l)}). Загляните в «Что публикуем» — там шаблон от медиа-штаба.` : 'В «Пиши-Делись» пока нет ваших постов. Загляните в «Что публикуем» — там шаблон от медиа-штаба.' });
  }
  await send(out, dry);
  return { sent: dry ? 0 : out.length, preview: dry ? out.map((x) => x.text) : undefined };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-hook-secret') !== (await secret('hook_secret'))) return json({ error: 'forbidden' }, 403);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'weekly') return json(await weekly(!!body.dry));
    if (body.action === 'pd_remind') return json(await pdRemind(!!body.dry));
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'error' }, 500);
  }
});
