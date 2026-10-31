import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { planConversation, type BotAttachment, type BotContext, type BotMessage } from './conversation.ts';
import { appUrl, equalSecret, MAX_FILE_BYTES, validateInitData } from './protocol.ts';

interface Dependencies {
  admin: SupabaseClient;
  authClient: () => SupabaseClient;
  token: string;
  supabaseUrl: string;
  fetch?: typeof fetch;
}
interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
}
interface Update {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; is_bot?: boolean };
    text?: string;
    caption?: string;
    photo?: TelegramFile[];
    document?: TelegramFile;
  };
  callback_query?: {
    id: string;
    from: { id: number; is_bot?: boolean };
    data?: string;
    message?: { chat: { id: number; type: string } };
  };
}
export function createTelegramHandler(deps: Dependencies) {
  const { admin, token } = deps;
  const sendFetch = deps.fetch ?? fetch;
  const cache = new Map<string, { value: string; until: number }>();
  async function secret(key: string): Promise<string> {
    const old = cache.get(key);
    if (old && old.until > Date.now()) return old.value;
    const { data, error } = await admin.from('app_secrets').select('value').eq('key', key).maybeSingle();
    if (error) throw new Error('Не удалось прочитать настройки бота.');
    const value = data?.value ?? '';
    cache.set(key, { value, until: Date.now() + 60000 });
    return value;
  }
  async function tg(method: string, payload: unknown) {
    if (!token) throw new Error('Токен Telegram-бота не настроен.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await sendFetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (result.ok) return result.result;
      const retryAfter = result.parameters?.retry_after;
      if (attempt === 0 && result.error_code === 429 && Number.isInteger(retryAfter) && retryAfter >= 0 && retryAfter <= 3) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000 + 100));
        continue;
      }
      const error = new Error('Telegram временно не ответил. Повторите действие позже.');
      Object.assign(error, { telegramCode: result.error_code });
      throw error;
    }
    throw new Error('Telegram временно не ответил.');
  }
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await admin.rpc(name, args).abortSignal(AbortSignal.timeout(15000));
    if (error) throw new Error(error.message);
    return data as T;
  }
  async function deliver(chatId: number, messages: BotMessage[], base: string) {
    for (let index = 0; index < messages.length; index++) {
      if (index) await new Promise((resolve) => setTimeout(resolve, 1050));
      const message = messages[index];
      await tg('sendMessage', {
        chat_id: chatId,
        text: message.text,
        link_preview_options: { is_disabled: true },
        ...(message.buttons?.length
          ? {
              reply_markup: {
                inline_keyboard: message.buttons.map((row) =>
                  row.map((b) => (b.app !== undefined ? { text: b.text, web_app: { url: appUrl(base, b.app) } } : b)),
                ),
              },
            }
          : {}),
      });
    }
  }
  async function configure(base: string) {
    const hook = await secret('hook_secret');
    if (!hook) throw new Error('Секрет вебхука не настроен.');
    const url = appUrl(base),
      bot = await tg('getMe', {});
    await tg('setMyCommands', {
      commands: [
        { command: 'app', description: 'Открыть сайт в Telegram' },
        { command: 'tasks', description: 'Мои задачи и сдача результата' },
        { command: 'daily', description: 'Заполнить отчёт дня' },
        { command: 'weekly', description: 'Заполнить недельный отчёт' },
        { command: 'resume', description: 'Продолжить черновик' },
        { command: 'cancel', description: 'Отменить незавершённый черновик' },
        { command: 'help', description: 'Помощь и меню' },
        { command: 'stop', description: 'Отключить Telegram от учётной записи' },
      ],
    });
    await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Открыть сайт', web_app: { url } } });
    await tg('setWebhook', {
      url: `${deps.supabaseUrl}/functions/v1/telegram`,
      secret_token: hook,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 1,
    });
    const value = {
      username: bot.username,
      connectedAt: new Date().toISOString(),
      miniApp: true,
      emergencyForms: true,
      version: 2,
    };
    const result = await admin.from('settings').upsert({ key: 'telegram', value });
    if (result.error) throw new Error('Настройки Telegram не сохранены.');
    return { ok: true, ...value };
  }
  async function miniAuth(raw: string, authorization: string) {
    const identity = await validateInitData(raw, token);
    const { data: link, error: linkError } = await admin
      .from('telegram_links')
      .select('user_id')
      .eq('chat_id', identity.id)
      .maybeSingle();
    if (linkError || !link)
      throw new Error('Telegram ещё не подключён. Войдите почтой и выберите «Профиль → Подключить Telegram».');
    const { data: profile } = await admin.from('profiles').select('data').eq('id', link.user_id).maybeSingle();
    if (!profile?.data?.active || profile.data.pending)
      throw new Error('Доступ к учётной записи отключён или ожидает подтверждения.');
    if (authorization) {
      const { data: existing } = await admin.auth.getUser(authorization);
      if (existing.user?.id === link.user_id) return { alreadyAuthenticated: true, userId: link.user_id };
    }
    const { data: account, error } = await admin.auth.admin.getUserById(link.user_id),
      user = account?.user;
    if (
      error ||
      !user?.email ||
      (user.factors ?? []).some((f) => f.status === 'verified') ||
      ('banned_until' in user && Date.parse(String(user.banned_until)) > Date.now())
    )
      throw new Error('Для этой учётной записи используйте обычный вход на сайте.');
    await rpc('telegram_claim_login', { p_hash: identity.hash, p_chat_id: identity.id });
    const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
    if (generated.error || generated.data.user?.id !== link.user_id || !generated.data.properties?.hashed_token)
      throw new Error('Не удалось подготовить вход. Повторно откройте мини-приложение.');
    const verified = await deps
      .authClient()
      .auth.verifyOtp({ token_hash: generated.data.properties.hashed_token, type: 'email' });
    if (verified.error || !verified.data.session || verified.data.user?.id !== link.user_id)
      throw new Error('Не удалось завершить вход. Повторно откройте мини-приложение.');
    const { data: freshLink } = await admin.from('telegram_links').select('user_id').eq('chat_id', identity.id).maybeSingle();
    const { data: freshProfile } = await admin.from('profiles').select('data').eq('id', link.user_id).maybeSingle();
    if (freshLink?.user_id !== link.user_id || !freshProfile?.data?.active || freshProfile.data.pending)
      throw new Error('Подключение Telegram изменилось. Откройте приложение заново.');
    return {
      userId: link.user_id,
      access_token: verified.data.session.access_token,
      refresh_token: verified.data.session.refresh_token,
    };
  }
  async function attachment(file: TelegramFile, photo: boolean, ctx: BotContext): Promise<BotAttachment> {
    if (!ctx.me || !ctx.draft || ctx.draft.stage !== 'attachments' || ctx.draft.kind !== 'result')
      throw new Error('Сначала выберите задачу и заполните текст результата.');
    if (ctx.draft.attachments.length >= 10) throw new Error('Можно добавить до 10 материалов.');
    if ((file.file_size ?? 0) > MAX_FILE_BYTES) throw new Error('Файл больше 10 МБ. Пришлите меньший файл или ссылку.');
    const remote = await tg('getFile', { file_id: file.file_id });
    if (
      remote.file_size > MAX_FILE_BYTES ||
      typeof remote.file_path !== 'string' ||
      !/^[\w/.-]+$/.test(remote.file_path) ||
      remote.file_path.includes('..')
    )
      throw new Error('Не удалось загрузить файл. Пришлите ссылку.');
    const response = await sendFetch(`https://api.telegram.org/file/bot${token}/${remote.file_path}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || +(response.headers.get('content-length') ?? 0) > MAX_FILE_BYTES || !response.body)
      throw new Error('Не удалось скачать файл. Повторите отправку или пришлите ссылку.');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_FILE_BYTES) {
        await reader.cancel();
        throw new Error('Файл больше 10 МБ.');
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const fileId = file.file_unique_id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
    if (!fileId) throw new Error('Не удалось определить файл.');
    const name = (photo ? 'Фото.jpg' : (file.file_name ?? 'Файл')).replace(/[\r\n/\\]/g, '_').slice(0, 180);
    const extension = photo ? '.jpg' : (/\.[a-zA-Z0-9]{1,8}$/.exec(name)?.[0].toLowerCase() ?? '');
    const path = `${ctx.me.id}/telegram/${ctx.draft.id}/${fileId}${extension}`;
    const stored = await admin.storage
      .from('attachments')
      .upload(path, bytes, { contentType: photo ? 'image/jpeg' : (file.mime_type ?? 'application/octet-stream'), upsert: false });
    if (stored.error && !/already exists|duplicate/i.test(stored.error.message))
      throw new Error('Файл не сохранён. Пришлите JPG, PNG, PDF или ссылку и повторите отправку.');
    return { id: `tg_${fileId}`, name, kind: photo ? 'photo' : 'file', size, url: `sb://attachments/${path}` };
  }
  async function onUpdate(update: Update, base: string) {
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return;
    const callback = update.callback_query,
      message = update.message;
    const chat = callback?.message?.chat ?? message?.chat,
      from = callback?.from ?? message?.from;
    if (
      !chat ||
      chat.type !== 'private' ||
      !from ||
      from.id !== chat.id ||
      from.is_bot ||
      !Number.isSafeInteger(chat.id) ||
      chat.id <= 0
    )
      return;
    if (callback) await tg('answerCallbackQuery', { callback_query_id: callback.id }).catch(() => {});
    const ctx = await rpc<BotContext>('telegram_bot_context', { p_chat_id: chat.id });
    let messages: BotMessage[];
    try {
      const file = message?.document ?? message?.photo?.at(-1),
        proof = file ? await attachment(file, !message?.document, ctx) : undefined;
      const plan = planConversation(ctx, {
        text: message?.text ?? message?.caption,
        callback: callback?.data,
        attachment: proof,
      });
      messages = await rpc<BotMessage[]>('telegram_bot_apply', {
        p_update_id: update.update_id,
        p_chat_id: chat.id,
        p_user_id: ctx.userId,
        p_revision: ctx.revision,
        p_draft: plan.draft,
        p_operation: plan.operation ?? null,
        p_reply: plan.reply,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : '';
      const human =
        /Отчёт|отчёт|Задач|задач|Ссылка|ссылк|Telegram|Черновик|черновик|Материал|материал|Файл|файл|аккаунт|Учётн|учётн|Профиль|профиль|Недостаточно|Ответственн|ответственн/.test(
          text,
        ) && !/JWT|token|relation|column|SQL|postgres|stack/i.test(text);
      messages = [
        {
          text:
            (human ? text : 'Сервер не подтвердил сохранение. Черновик остался в боте. Повторите отправку позже.') +
            '\n\nПродолжить — /resume, отменить — /cancel.',
          ...(ctx.draft
            ? {
                buttons: [
                  [{ text: 'Продолжить', callback_data: 'resume' }],
                  ...(ctx.draft.stage === 'confirm'
                    ? [[{ text: 'Обновить версию и сверить', callback_data: `refresh:${ctx.draft.nonce}` }]]
                    : []),
                ],
              }
            : {}),
        },
      ];
    }
    await deliver(chat.id, messages, base);
  }
  async function onNotify(body: { user_id?: string; text?: string; link?: string }, base: string) {
    if (!body.user_id || typeof body.text !== 'string') return;
    const { data: link } = await admin.from('telegram_links').select('chat_id').eq('user_id', body.user_id).maybeSingle();
    if (!link) return;
    try {
      await deliver(
        Number(link.chat_id),
        [{ text: body.text.slice(0, 4000), buttons: [[{ text: 'Открыть в приложении', app: body.link ?? '' }]] }],
        base,
      );
    } catch (error) {
      if ((error as { telegramCode?: number }).telegramCode === 403)
        await admin.from('telegram_links').delete().eq('user_id', body.user_id);
      else throw error;
    }
  }
  return async (req: Request) => {
    const base = (await secret('app_url').catch(() => '')) || 'https://timativ-blip.github.io/nlMO/';
    const cors = {
      'Access-Control-Allow-Origin': new URL(base).origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
      'Cache-Control': 'no-store',
    };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);
    const raw = await req.text();
    if (raw.length > 262144) return json({ error: 'Слишком большой запрос.' }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Некорректный запрос.' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Некорректный запрос.' }, 400);
    const hook = await secret('hook_secret').catch(() => '');
    const tgHeader = req.headers.get('x-telegram-bot-api-secret-token'),
      dbHeader = req.headers.get('x-hook-secret');
    try {
      if (tgHeader !== null) {
        if (!equalSecret(tgHeader, hook)) return json({ error: 'forbidden' }, 403);
        await onUpdate(body, base);
        return json({ ok: true });
      }
      if (dbHeader !== null) {
        if (!equalSecret(dbHeader, hook)) return json({ error: 'forbidden' }, 403);
        if (body.action === 'configure') return json(await configure(base));
        if (body.action === 'status') {
          const info = await tg('getWebhookInfo', {}),
            menu = await tg('getChatMenuButton', {}),
            commands = await tg('getMyCommands', {});
          return json({
            ok: true,
            webhook: {
              url: info.url,
              pending: info.pending_update_count,
              allowed_updates: info.allowed_updates,
              last_error_message: info.last_error_message,
            },
            menu,
            commands,
          });
        }
        await onNotify(body, base);
        return json({ ok: true });
      }
      const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      if (body.action === 'mini_auth') {
        try {
          return json(await miniAuth(typeof body.initData === 'string' ? body.initData : '', bearer));
        } catch (error) {
          return json({ error: (error as Error).message }, 401);
        }
      }
      const { data: auth } = await admin.auth.getUser(bearer);
      if (!auth.user) return json({ error: 'Войдите в систему заново.' }, 401);
      const { data: me } = await admin.from('profiles').select('data').eq('id', auth.user.id).maybeSingle();
      if (!me?.data?.active || me.data.pending || me.data.role !== 'head')
        return json({ error: 'Настраивать бота может руководитель области.' }, 403);
      if (body.action === 'setup') {
        const next = typeof body.appUrl === 'string' ? body.appUrl : base;
        appUrl(next);
        const configured = await configure(next);
        const result = await admin
          .from('app_secrets')
          .upsert({ key: 'app_url', value: new URL(next).origin + new URL(next).pathname });
        if (result.error) throw new Error('Адрес сайта не сохранён.');
        cache.delete('app_url');
        return json(configured);
      }
      return json({ error: 'Неизвестное действие.' }, 400);
    } catch {
      return json({ error: 'Не удалось завершить действие. Повторите попытку позже.' }, tgHeader !== null ? 503 : 500);
    }
  };
}
