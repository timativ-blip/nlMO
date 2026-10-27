// Telegram-бот «Командного центра».
//  • вебхук от Telegram: /start <код> привязывает чат к профилю, /stop — отвязывает;
//  • вызов из базы (триггер на notifications): отправка уведомления привязанному сотруднику;
//  • action=setup от руководителя: регистрация вебхука и сохранение имени бота.
// Токен бота задаётся секретом TELEGRAM_BOT_TOKEN в настройках Edge Functions.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

let secrets: Record<string, string> | null = null;
async function secret(key: string) {
  if (!secrets) {
    const { data } = await admin.from('app_secrets').select('key, value');
    secrets = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  }
  return secrets[key] ?? '';
}
// Имя для обращения при любом порядке «Фамилия Имя» / «Имя Фамилия» (как src/lib/names.ts)
const SURNAME = /(ов|ев|ёв|ин|ын|ский|цкий|ской|цкой|ой|ая|ова|ева|ёва|ина|ына|ская|цкая|ко|ук|юк|чук|енко|ых|их|ман|ер|дзе|швили|ян)$/i;
function firstName(full: string) {
  const [a = '', b = ''] = full.trim().split(/\s+/);
  if (!b) return a;
  return SURNAME.test(a) && !SURNAME.test(b) ? b : a;
}
async function tg(method: string, payload: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return r.json();
}

async function onUpdate(update: { message?: { chat: { id: number }; text?: string } }) {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const [cmd, arg] = msg.text.trim().split(/\s+/, 2);
  if (cmd === '/start' && arg) {
    const { data: code } = await admin.from('telegram_link_codes').select('user_id, created_at').eq('code', arg).single();
    if (!code || Date.now() - Date.parse(code.created_at) > 24 * 3600e3) {
      await tg('sendMessage', { chat_id: chatId, text: 'Ссылка устарела. Откройте профиль в Командном центре и нажмите «Подключить Telegram» ещё раз.' });
      return;
    }
    await admin.from('telegram_links').upsert({ user_id: code.user_id, chat_id: chatId, linked_at: new Date().toISOString() });
    await admin.from('telegram_link_codes').delete().eq('user_id', code.user_id);
    const { data: p } = await admin.from('profiles').select('data').eq('id', code.user_id).single();
    await tg('sendMessage', { chat_id: chatId, text: `Готово, ${p?.data?.name ? firstName(p.data.name) : 'коллега'}! Сюда будут приходить уведомления: назначения, сроки, комментарии, проверка результатов и изменения мероприятий.\n\nОтключить — /stop` });
  } else if (cmd === '/stop') {
    await admin.from('telegram_links').delete().eq('chat_id', chatId);
    await tg('sendMessage', { chat_id: chatId, text: 'Уведомления отключены. Подключить снова можно в профиле Командного центра.' });
  } else {
    await tg('sendMessage', { chat_id: chatId, text: 'Это бот уведомлений Командного центра. Чтобы подключиться, откройте свой профиль в приложении и нажмите «Подключить Telegram».' });
  }
}

async function onNotify(body: { user_id: string; text: string; link?: string }) {
  const { data: link } = await admin.from('telegram_links').select('chat_id').eq('user_id', body.user_id).single();
  if (!link || !TOKEN) return;
  const appUrl = await secret('app_url');
  const payload: Record<string, unknown> = { chat_id: link.chat_id, text: body.text };
  if (appUrl && body.link) payload.reply_markup = { inline_keyboard: [[{ text: 'Открыть в Командном центре', url: appUrl + body.link }]] };
  const r = await tg('sendMessage', payload);
  // Пользователь заблокировал бота — отвязываем, чтобы не слать впустую
  if (!r.ok && r.error_code === 403) await admin.from('telegram_links').delete().eq('user_id', body.user_id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const hook = await secret('hook_secret');
  const body = await req.json().catch(() => ({}));

  const tgHeader = req.headers.get('x-telegram-bot-api-secret-token');
  if (tgHeader !== null) {
    if (tgHeader !== hook) return json({ error: 'forbidden' }, 403);
    await onUpdate(body).catch(console.error);
    return json({ ok: true });
  }
  const dbHeader = req.headers.get('x-hook-secret');
  if (dbHeader !== null) {
    if (dbHeader !== hook) return json({ error: 'forbidden' }, 403);
    await onNotify(body).catch(console.error);
    return json({ ok: true });
  }

  // Действия руководителя из приложения
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return json({ error: 'Войдите в систему заново.' }, 401);
  const { data: me } = await admin.from('profiles').select('data').eq('id', auth.user.id).single();
  if (me?.data?.role !== 'head') return json({ error: 'Подключать бота может руководитель области.' }, 403);
  if (body.action === 'setup') {
    if (!TOKEN) return json({ error: 'Токен бота не задан. Добавьте секрет TELEGRAM_BOT_TOKEN в Supabase → Edge Functions → Secrets.' }, 400);
    const bot = await tg('getMe', {});
    if (!bot.ok) return json({ error: 'Telegram не принял токен — проверьте, что скопировали его из @BotFather полностью.' }, 400);
    const wh = await tg('setWebhook', { url: `${SUPABASE_URL}/functions/v1/telegram`, secret_token: hook, allowed_updates: ['message'] });
    if (!wh.ok) return json({ error: `Не удалось подключить вебхук: ${wh.description}` }, 400);
    if (body.appUrl) await admin.from('app_secrets').upsert({ key: 'app_url', value: String(body.appUrl) });
    const value = { username: bot.result.username, connectedAt: new Date().toISOString() };
    await admin.from('settings').upsert({ key: 'telegram', value });
    return json({ ok: true, ...value });
  }
  return json({ error: 'Неизвестное действие.' }, 400);
});
