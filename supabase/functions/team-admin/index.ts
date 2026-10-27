// Учётные записи команды без отправки писем: руководитель (или координатор — для участников
// своего округа) создаёт сотрудника и получает временный пароль, который передаёт ему лично.
// bootstrap — создание первого руководителя, работает только пока в системе нет ни одного профиля.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => json({ error }, status);
const ROLES = ['head', 'coordinator', 'staff', 'member'];
const TITLES = ['head', 'developer', 'deputy', 'coordinator', 'staff', 'media', 'member', 'party_member'];

function genPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}

interface NewPerson { name?: string; email?: string; phone?: string; role?: string; title?: string; districtId?: string | null; position?: string; telegram?: string; birthday?: string }

async function createPerson(p: NewPerson, password: string, extra: Record<string, unknown> = {}) {
  const email = (p.email ?? '').trim().toLowerCase();
  const name = (p.name ?? '').trim();
  if (name.split(/\s+/).length < 2) throw new Error('Укажите имя и фамилию.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error(`Проверьте почту «${email}»: она нужна для входа.`);
  if (!ROLES.includes(p.role ?? '')) throw new Error('Неизвестная роль.');
  if (p.title && !TITLES.includes(p.title)) throw new Error('Неизвестная роль в команде.');
  if ((p.role === 'coordinator' || p.role === 'member') && !p.districtId) throw new Error('Для координатора и участника нужен округ.');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(/already|registered|exists/i.test(error.message) ? `Пользователь с почтой ${email} уже есть.` : error.message);
  const id = data.user.id;
  const profile = {
    id, name, role: p.role, title: p.title || null, position: p.position ?? '', districtId: p.districtId ?? null, email, phone: p.phone ?? '',
    telegram: p.telegram || undefined, birthday: p.birthday || undefined, birthdayVisibility: 'district', active: true, ...extra,
  };
  const { error: e2 } = await admin.from('profiles').insert({ id, data: profile });
  if (e2) { await admin.auth.admin.deleteUser(id); throw new Error(e2.message); }
  if (p.role === 'coordinator' && p.districtId && extra.active !== false) {
    const { data: d } = await admin.from('districts').select('data').eq('id', p.districtId).single();
    if (d && !d.data.coordinatorId) await admin.from('districts').update({ data: { ...d.data, coordinatorId: id } }).eq('id', p.districtId);
  }
  return { id, profile };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json();
    if (body.action === 'bootstrap') {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true });
      if (count) return fail('Система уже настроена — войдите своей учётной записью.');
      if (!body.password || String(body.password).length < 8) return fail('Пароль — не короче 8 символов.');
      const r = await createPerson({ ...body.profile, role: 'head', title: 'head', districtId: null }, String(body.password));
      return json({ ok: true, id: r.id });
    }

    // Самостоятельная регистрация: учётная запись создаётся неактивной, до одобрения заявки
    if (body.action === 'register') {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true });
      if (!count) return fail('Система ещё не настроена — сначала руководитель проходит «Первый запуск».');
      const p: NewPerson = body.profile ?? {};
      const kind = body.kind === 'hq' ? 'hq' : 'okrug';
      if (!body.password || String(body.password).length < 8) return fail('Пароль — не короче 8 символов.');
      let districtId: string | null = null;
      if (kind === 'okrug') {
        const { data: d } = await admin.from('districts').select('id').eq('id', String(p.districtId ?? '')).maybeSingle();
        if (!d) return fail('Выберите свой округ.');
        districtId = d.id;
      }
      const r = await createPerson({ name: p.name, email: p.email, phone: p.phone, position: p.position, role: kind === 'hq' ? 'staff' : 'member', title: kind === 'hq' ? 'staff' : 'member', districtId }, String(body.password), { active: false, pending: true });
      const { data: all } = await admin.from('profiles').select('id, data');
      const approvers = (all ?? []).filter((x) => x.data.active !== false && (x.data.role === 'head' || (kind === 'okrug' && x.data.role === 'coordinator' && x.data.districtId === districtId)));
      const text = `Новая заявка на доступ: ${r.profile.name} — ${kind === 'hq' ? 'сотрудник штаба МО' : `участник округа ${districtId}`}`;
      if (approvers.length) await admin.from('notifications').insert(approvers.map((x) => {
        const nid = `reg_${r.id.slice(0, 8)}_${x.id.slice(0, 8)}`;
        return { id: nid, user_id: x.id, data: { id: nid, userId: x.id, text, at: new Date().toISOString(), read: false, link: '#/team/requests', kind: 'assign' } };
      }));
      return json({ ok: true });
    }

    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const { data: auth } = await admin.auth.getUser(token);
    if (!auth.user) return fail('Войдите в систему заново.', 401);
    const { data: meRow } = await admin.from('profiles').select('data').eq('id', auth.user.id).single();
    const me = meRow?.data;
    if (!me || me.active === false) return fail('Учётная запись не активна.', 403);

    if (body.action === 'create_user') {
      const p: NewPerson = body.profile ?? {};
      const allowed = me.role === 'head' || (me.role === 'coordinator' && p.role === 'member' && p.districtId === me.districtId);
      if (!allowed) return fail('Добавлять людей может руководитель области; координатор — только участников своего округа.', 403);
      const password = genPassword();
      const r = await createPerson(p, password);
      return json({ ok: true, id: r.id, profile: r.profile, password });
    }

    if (body.action === 'reset_password') {
      const { data: t } = await admin.from('profiles').select('data').eq('id', body.userId).single();
      if (!t) return fail('Сотрудник не найден.', 404);
      const allowed = me.role === 'head' || (me.role === 'coordinator' && t.data.role === 'member' && t.data.districtId === me.districtId);
      if (!allowed) return fail('Сбросить пароль может руководитель или координатор округа.', 403);
      const password = genPassword();
      const { error } = await admin.auth.admin.updateUserById(body.userId, { password });
      if (error) return fail(error.message);
      return json({ ok: true, password });
    }
    return fail('Неизвестное действие.');
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Ошибка сервера');
  }
});
