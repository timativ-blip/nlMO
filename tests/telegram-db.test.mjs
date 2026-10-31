import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { createTelegramHandler, planConversation } from '../.test-telegram/telegram-entry.js';

let db,
  today,
  week,
  counter = 1;
const ids = {
  head: '00000000-0000-0000-0000-000000000001',
  one: '00000000-0000-0000-0000-000000000002',
  two: '00000000-0000-0000-0000-000000000003',
  member: '00000000-0000-0000-0000-000000000004',
};
const chats = { one: 1001, two: 1002, member: 1003, head: 1004 };
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
async function service(fn) {
  await db.exec('set role service_role');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const context = (chat) => service(() => scalar('select public.telegram_bot_context($1)', [chat]));
const apply = (chat, ctx, plan, id = counter++) =>
  service(() =>
    scalar('select public.telegram_bot_apply($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)', [
      id,
      chat,
      ctx.userId,
      ctx.revision,
      plan.draft ? JSON.stringify(plan.draft) : null,
      plan.operation ? JSON.stringify(plan.operation) : null,
      JSON.stringify(plan.reply),
    ]),
  );
async function step(chat, input, id) {
  const ctx = await context(chat),
    plan = planConversation(ctx, input);
  await apply(chat, ctx, plan, id);
  return plan;
}
async function click(chat, action, value) {
  const ctx = await context(chat);
  return step(chat, { callback: [action, ...(value === undefined ? [] : [value]), ctx.draft.nonce].join(':') });
}
async function daily(chat) {
  await step(chat, { text: '/daily' });
  await click(chat, 'd', today);
  await step(chat, { text: 'Проведены встречи и подготовлены публикации.' });
  await step(chat, { text: 'Следующая встреча' });
  await step(chat, { text: '-' });
}
async function result(chat, id) {
  await step(chat, { text: '/tasks' });
  await click(chat, 't', id);
  await step(chat, { text: 'Встреча проведена, участники получили материалы.' });
  await step(chat, { text: '12' });
  await step(chat, { text: '/done' });
}

before(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema extensions;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;",
  );
  await db.exec(
    'create schema net;create table net.fixture_outbox(id bigserial primary key,url text,body jsonb,headers jsonb);create function net.http_post(url text,body jsonb,headers jsonb) returns bigint language plpgsql as $$declare item bigint;begin insert into net.fixture_outbox(url,body,headers) values(url,body,headers) returning id into item;return item;end$$;',
  );
  const initial = readFileSync(new URL('../supabase/migrations/001_init.sql', import.meta.url), 'utf8');
  await db.exec(
    initial
      .slice(initial.indexOf('create table profiles'), initial.indexOf('-- Хранилище вложений'))
      .replace(/select cron\.schedule\([^;]+;/g, '')
      .replace(/alter publication supabase_realtime[^;]+;/g, ''),
  );
  const dailySQL = readFileSync(new URL('../supabase/migrations/004_roles_registration_daily.sql', import.meta.url), 'utf8');
  await db.exec(
    dailySQL.slice(
      dailySQL.indexOf('create table daily_reports'),
      dailySQL.indexOf('alter publication supabase_realtime add table daily_reports;'),
    ),
  );
  await db.exec(
    'grant usage on schema public to service_role;grant select,insert,update,delete on all tables in schema public to service_role;grant usage,select on all sequences in schema public to service_role',
  );
  await db.exec(
    readFileSync(new URL('../supabase/migrations/20261031192535_telegram_miniapp_and_emergency.sql', import.meta.url), 'utf8'),
  );
  for (const [key, id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id) values($1)', [id]);
    await db.query('insert into profiles(id,data) values($1,$2::jsonb)', [
      id,
      JSON.stringify({
        id,
        name: key,
        role: key === 'head' ? 'head' : key === 'member' ? 'member' : 'coordinator',
        districtId: key === 'head' ? null : key === 'two' ? '119' : '118',
        active: true,
        pending: false,
      }),
    ]);
  }
  for (const id of ['118', '119'])
    await db.query('insert into districts(id,data) values($1,$2::jsonb)', [
      id,
      JSON.stringify({ id, name: id, coordinatorId: ids.head }),
    ]);
  await db.query('insert into metrics(id,data) values($1,$2::jsonb)', [
    'people',
    JSON.stringify({ id: 'people', name: 'Участники', unit: 'чел.' }),
  ]);
  today = await scalar('select public.msk_today()');
  week = await scalar("select to_char(date_trunc('week',now() at time zone 'Europe/Moscow'),'YYYY-MM-DD')");
});
beforeEach(async () => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec(
    'truncate telegram_login_claims,telegram_bot_updates,telegram_bot_drafts,telegram_link_codes,telegram_links,tasks,reports,daily_reports,notifications,audit_log,net.fixture_outbox',
  );
  await db.query("update profiles set data=jsonb_set(data,'{active}','true')");
  for (const [key, id] of Object.entries(ids))
    await db.query('insert into telegram_links(user_id,chat_id) values($1,$2)', [id, chats[key]]);
  for (const [key, district] of [
    ['one', '118'],
    ['two', '119'],
  ]) {
    const task = {
      id: 'task-' + key,
      title: 'Встреча ' + key,
      description: '',
      assigneeId: ids[key],
      coAssigneeIds: [],
      authorId: ids.head,
      districtId: district,
      status: 'new',
      priority: 'normal',
      due: today,
      metricId: 'people',
      eventId: null,
      checklist: [],
      comments: [],
      history: [],
      attachments: [],
      result: null,
    };
    await db.query('insert into tasks(id,data) values($1,$2::jsonb)', [task.id, JSON.stringify(task)]);
    const report = {
      id: 'report-' + key,
      districtId: district,
      weekStart: week,
      status: 'draft',
      conclusions: '',
      problems: '',
      plan: '',
      history: [],
      updatedAt: 'initial',
    };
    await db.query('insert into reports(id,data) values($1,$2::jsonb)', [report.id, JSON.stringify(report)]);
  }
});
after(async () => {
  await db?.close();
});

test('bot context contains only own actionable tasks and reports permitted by role', async () => {
  const ctx = await context(chats.one);
  assert.deepEqual(
    ctx.tasks.map((t) => t.id),
    ['task-one'],
  );
  assert.deepEqual(
    ctx.reports.map((t) => t.id),
    ['report-one'],
  );
  assert.equal(ctx.me.id, ids.one);
  assert.equal((await context(chats.member)).reports.length, 0);
  assert.equal((await context(999999)).me, null);
  assert.equal((await context(chats.head)).reports.filter((r) => r.revision !== null).length, 2);
});
test('daily report stays a bot draft until confirmed, then follows normal reporting and audit rules', async () => {
  await daily(chats.one);
  assert.equal(await scalar('select count(*)::int from daily_reports'), 0);
  await click(chats.one, 'confirm');
  const saved = await scalar('select data from daily_reports');
  assert.equal(saved.userId, ids.one);
  assert.equal(saved.day, today);
  assert.match(saved.done, /Проведены встречи/);
  assert.equal((await context(chats.one)).draft, null);
  assert.equal(await scalar("select count(*)::int from audit_log where entity='daily_reports'"), 1);
});
test('repeated delivery of the same confirmation cannot duplicate records, notifications or history', async () => {
  await result(chats.one, 'task-one');
  const ctx = await context(chats.one),
    plan = planConversation(ctx, { callback: 'confirm:' + ctx.draft.nonce });
  const id = counter++;
  const first = await apply(chats.one, ctx, plan, id);
  const again = await apply(chats.one, await context(chats.one), { draft: null, reply: [{ text: 'other' }] }, id);
  assert.deepEqual(first, again);
  const saved = await scalar("select data from tasks where id='task-one'");
  assert.equal(saved.status, 'review');
  assert.equal(saved.result.value, 12);
  assert.equal(saved.comments.length, 1);
  assert.equal(saved.history.length, 1);
  assert.equal(await scalar('select count(*)::int from notifications'), 1);
  assert.equal(await scalar("select data->>'status' from tasks where id='task-two'"), 'new');
});
test('the ordinary independent reviewer is still required after submission through the bot', async () => {
  await result(chats.one, 'task-one');
  await click(chats.one, 'confirm');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.one]);
  await db.exec('set role service_role');
  try {
    await assert.rejects(
      db.query('update tasks set data=data||\'{"status":"done"}\'::jsonb where id=\'task-one\''),
      /не по своей задаче/,
    );
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
  assert.equal(await scalar("select data->>'status' from tasks where id='task-one'"), 'review');
});
test('a weekly report saves its text and sends to review atomically', async () => {
  await step(chats.one, { text: '/weekly' });
  await click(chats.one, 'w', 'report-one');
  for (const value of ['Главные итоги недели', 'Есть проблема', 'План следующей недели']) await step(chats.one, { text: value });
  assert.equal(await scalar("select data->>'status' from reports where id='report-one'"), 'draft');
  await click(chats.one, 'confirm');
  const saved = await scalar("select data from reports where id='report-one'");
  assert.equal(saved.status, 'sent');
  assert.equal(saved.conclusions, 'Главные итоги недели');
  assert.equal(saved.problems, 'Есть проблема');
  assert.equal(saved.plan, 'План следующей недели');
  assert.equal(await scalar('select count(*)::int from notifications'), 1);
});
test('a new reporting week works through the bot even when nobody has opened the website', async () => {
  await db.exec('truncate reports');
  const ctx = await context(chats.one);
  assert.equal(ctx.reports.length, 1);
  assert.equal(ctx.reports[0].revision, null);
  const target = ctx.reports[0].id;
  await step(chats.one, { text: '/weekly' });
  await click(chats.one, 'w', target);
  for (const value of ['Итоги новой недели', '-', 'План новой недели']) await step(chats.one, { text: value });
  assert.equal(await scalar('select count(*)::int from reports'), 0);
  await click(chats.one, 'confirm');
  assert.equal(await scalar("select data->>'status' from reports where id=$1", [target]), 'sent');
});
test('server-side edits cause a conflict without losing the bot draft or overwriting the newer report', async () => {
  await daily(chats.one);
  const id = `dr_${ids.one}_${today}`;
  await db.query('insert into daily_reports(id,user_id,day,data) values($1,$2,$3,$4::jsonb)', [
    id,
    ids.one,
    today,
    JSON.stringify({
      id,
      userId: ids.one,
      day: today,
      done: 'Обновлённый отчёт с сайта',
      plan: '',
      problems: '',
      updatedAt: 'new',
    }),
  ]);
  await assert.rejects(click(chats.one, 'confirm'), /Отчёт изменился/);
  assert.equal((await context(chats.one)).draft.stage, 'confirm');
  assert.equal(await scalar("select data->>'done' from daily_reports"), 'Обновлённый отчёт с сайта');
  await click(chats.one, 'refresh');
  await click(chats.one, 'confirm');
  assert.match(await scalar("select data->>'done' from daily_reports"), /Проведены встречи/);
});
test('a failing notification rolls back the whole submission and retains the confirmation draft', async () => {
  await result(chats.one, 'task-one');
  await db.exec(
    "create function test_bot_notification_failure() returns trigger language plpgsql as $$begin raise exception 'forced delivery failure';end$$;create trigger bot_test_failure before insert on notifications for each row execute function test_bot_notification_failure();",
  );
  try {
    await assert.rejects(click(chats.one, 'confirm'), /forced delivery failure/);
    assert.equal(await scalar("select data->>'status' from tasks where id='task-one'"), 'new');
    assert.equal((await context(chats.one)).draft.stage, 'confirm');
    assert.equal(await scalar('select count(*)::int from notifications'), 0);
  } finally {
    await db.exec('drop trigger bot_test_failure on notifications;drop function test_bot_notification_failure()');
  }
});
test('role changes and task reassignment are checked again at the instant of confirmation', async () => {
  await result(chats.one, 'task-one');
  await db.query("update tasks set data=jsonb_set(data,'{assigneeId}',to_jsonb($1::text)) where id='task-one'", [ids.two]);
  await assert.rejects(click(chats.one, 'confirm'), /Задача уже сдана|ответственным/);
  assert.equal((await context(chats.one)).draft.stage, 'confirm');
  await db.query("update profiles set data=jsonb_set(data,'{active}','false') where id=$1", [ids.one]);
  const ctx = await context(chats.one);
  assert.equal(ctx.me, null);
  assert.equal(ctx.draft, null);
});
test('old revisions cannot overwrite a newer conversation step', async () => {
  await step(chats.one, { text: '/daily' });
  const old = await context(chats.one);
  await click(chats.one, 'd', today);
  await assert.rejects(apply(chats.one, old, { draft: null, reply: [{ text: 'stale' }] }), /Черновик уже изменился/);
  assert.equal((await context(chats.one)).draft.stage, 'done');
});
test('Mini App login claims are one-use and inactive accounts cannot obtain them', async () => {
  const hash = 'a'.repeat(64);
  assert.equal(await service(() => scalar('select public.telegram_claim_login($1,$2)', [hash, chats.one])), ids.one);
  await assert.rejects(
    service(() => scalar('select public.telegram_claim_login($1,$2)', [hash, chats.one])),
    /уже использован/,
  );
  await db.query("update profiles set data=jsonb_set(data,'{active}','false') where id=$1", [ids.one]);
  await assert.rejects(
    service(() => scalar('select public.telegram_claim_login($1,$2)', ['b'.repeat(64), chats.one])),
    /активной/,
  );
});
test('connection codes are consumed atomically and one Telegram chat cannot silently change accounts', async () => {
  await db.query('delete from telegram_links where user_id=$1', [ids.one]);
  const code = 'a'.repeat(24);
  await db.query('insert into telegram_link_codes(code,user_id) values($1,$2)', [code, ids.one]);
  const ctx = await context(2001),
    plan = planConversation(ctx, { text: '/start ' + code });
  await apply(2001, ctx, plan);
  assert.equal((await context(2001)).me.id, ids.one);
  assert.equal(await scalar('select count(*)::int from telegram_link_codes'), 0);
  await db.query('insert into telegram_link_codes(code,user_id) values($1,$2)', ['b'.repeat(24), ids.two]);
  await assert.rejects(step(2001, { text: '/start ' + 'b'.repeat(24) }), /другой учётной/);
  assert.equal((await context(2001)).me.id, ids.one);
  await step(2001, { text: '/stop' });
  assert.equal((await context(2001)).me, null);
});
test('anonymous and signed-in browser roles cannot read bot drafts, replay messages or claim Telegram logins', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    try {
      await assert.rejects(db.query('select * from telegram_bot_drafts'), /permission denied/);
      await assert.rejects(db.query('select public.telegram_bot_context(1001)'), /permission denied/);
      await assert.rejects(db.query("select public.telegram_claim_login('abc',1001)"), /permission denied/);
    } finally {
      await db.exec('reset role');
    }
  }
});

function endpointFixture() {
  const sends = [],
    uploads = [],
    authCalls = [];
  let failDelivery = false;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const rpcArgs = {
    telegram_bot_context: ['p_chat_id'],
    telegram_claim_login: ['p_hash', 'p_chat_id'],
    telegram_bot_apply: ['p_update_id', 'p_chat_id', 'p_user_id', 'p_revision', 'p_draft', 'p_operation', 'p_reply'],
  };
  const client = createClient('https://database.example.invalid', 'fixture-service-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, options = {}) => {
        const u = new URL(url),
          table = u.pathname.split('/').at(-1),
          args = typeof options.body === 'string' ? JSON.parse(options.body) : {};
        if (u.pathname.includes('/rpc/')) {
          if (!rpcArgs[table]) throw Error('Unexpected RPC');
          try {
            const names = rpcArgs[table],
              values = names.map((key) =>
                ['p_draft', 'p_operation', 'p_reply'].includes(key) && args[key] !== null ? JSON.stringify(args[key]) : args[key],
              );
            return json(
              await service(() =>
                scalar(
                  `select public.${table}(${names.map((name, i) => '$' + (i + 1) + (['p_draft', 'p_operation', 'p_reply'].includes(name) ? '::jsonb' : '')).join(',')})`,
                  values,
                ),
              ),
            );
          } catch (error) {
            return json({ message: error.message, code: error.code }, 400);
          }
        }
        if (u.pathname.includes('/storage/')) {
          uploads.push(u.pathname);
          return json({ Key: u.pathname });
        }
        if (table === 'app_secrets') {
          const key = u.searchParams.get('key')?.slice(3);
          const value = { hook_secret: 'fixture-hook', app_url: 'https://app.example.org/' }[key];
          return json(value ? [{ value }] : []);
        }
        if (table === 'telegram_links') {
          const chat = u.searchParams.get('chat_id')?.slice(3),
            user = u.searchParams.get('user_id')?.slice(3);
          return json(
            (
              await db.query('select user_id,chat_id from telegram_links where ' + (chat ? 'chat_id=$1' : 'user_id=$1'), [
                chat ?? user,
              ])
            ).rows,
          );
        }
        if (table === 'profiles')
          return json((await db.query('select data from profiles where id=$1', [u.searchParams.get('id')?.slice(3)])).rows);
        throw Error('Unexpected database endpoint ' + u.pathname);
      },
    },
  });
  client.auth.getUser = async (bearer) => ({
    data: { user: bearer === 'existing-one' ? { id: ids.one } : bearer === 'existing-other' ? { id: ids.two } : null },
    error: null,
  });
  client.auth.admin.getUserById = async (id) => ({
    data: { user: { id, email: id + '@example.invalid', factors: [] } },
    error: null,
  });
  client.auth.admin.generateLink = async ({ email }) => {
    authCalls.push(email);
    return { data: { user: { id: email.split('@')[0] }, properties: { hashed_token: 'fixture-otp' } }, error: null };
  };
  const handle = createTelegramHandler({
    admin: client,
    authClient: () => ({
      auth: {
        verifyOtp: async () => ({
          data: { user: { id: ids.one }, session: { access_token: 'fixture-access', refresh_token: 'fixture-refresh' } },
          error: null,
        }),
      },
    }),
    token: 'fixture-token',
    supabaseUrl: 'https://database.example.invalid',
    fetch: async (url, options = {}) => {
      if (url.includes('/file/bot')) return new Response(new Uint8Array([1, 2, 3]));
      assert.ok(url.startsWith('https://api.telegram.org/botfixture-token/'));
      const method = url.split('/').at(-1),
        body = JSON.parse(options.body);
      if (method === 'sendMessage') {
        if (failDelivery) {
          failDelivery = false;
          return json({ ok: false, error_code: 500 });
        }
        sends.push(body);
        return json({ ok: true, result: { message_id: sends.length } });
      }
      if (method === 'answerCallbackQuery') return json({ ok: true, result: true });
      if (method === 'getFile') return json({ ok: true, result: { file_path: 'photos/file.jpg', file_size: 3 } });
      throw Error('Unexpected Telegram method ' + method);
    },
  });
  const call = (body, headers = {}) =>
    handle(
      new Request('https://database.example.invalid/functions/v1/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    );
  const webhook = (body) => call(body, { 'x-telegram-bot-api-secret-token': 'fixture-hook' });
  const message = (text) =>
    webhook({ update_id: counter++, message: { chat: { id: chats.one, type: 'private' }, from: { id: chats.one }, text } });
  const callback = async (action, value) => {
    const ctx = await context(chats.one);
    return webhook({
      update_id: counter++,
      callback_query: {
        id: 'fixture-query',
        from: { id: chats.one },
        message: { chat: { id: chats.one, type: 'private' } },
        data: [action, ...(value === undefined ? [] : [value]), ctx.draft.nonce].join(':'),
      },
    });
  };
  return {
    call,
    webhook,
    message,
    callback,
    sends,
    uploads,
    authCalls,
    failNextDelivery: () => {
      failDelivery = true;
    },
  };
}
test('HTTP webhook → real conversation → PostgreSQL saves only after confirmation and rejects forged webhooks', async () => {
  const f = endpointFixture();
  assert.equal((await f.call({ update_id: counter++ }, { 'x-telegram-bot-api-secret-token': 'wrong' })).status, 403);
  await f.webhook({
    update_id: counter++,
    message: { chat: { id: -1, type: 'group' }, from: { id: chats.one }, text: '/daily' },
  });
  assert.equal(f.sends.length, 0);
  assert.equal((await f.message('/daily')).status, 200);
  await f.callback('d', today);
  await f.message('Отчёт из Telegram: встречи проведены.');
  await f.message('Подготовить публикацию');
  await f.message('-');
  assert.equal(await scalar('select count(*)::int from daily_reports'), 0);
  await f.callback('confirm');
  assert.equal(await scalar('select count(*)::int from daily_reports'), 1);
  assert.match(f.sends.at(-1).text, /сохранён на сайте/);
});
test('photo upload and a lost Telegram reply recover without duplicating the result or leaking a bot token', async () => {
  const f = endpointFixture();
  await f.message('/tasks');
  await f.callback('t', 'task-one');
  await f.message('Задача выполнена, участники получили материалы.');
  await f.message('15');
  await f.webhook({
    update_id: counter++,
    message: {
      chat: { id: chats.one, type: 'private' },
      from: { id: chats.one },
      photo: [{ file_id: 'fixture-file', file_unique_id: 'unique-photo', file_size: 3 }],
    },
  });
  assert.equal(f.uploads.length, 1);
  assert.ok(f.uploads[0].includes(ids.one + '/telegram/'));
  await f.message('/done');
  const ctx = await context(chats.one);
  const update = {
    update_id: counter++,
    callback_query: {
      id: 'confirm-query',
      from: { id: chats.one },
      message: { chat: { id: chats.one, type: 'private' } },
      data: 'confirm:' + ctx.draft.nonce,
    },
  };
  f.failNextDelivery();
  assert.equal((await f.webhook(update)).status, 503);
  assert.equal((await f.webhook(update)).status, 200);
  const saved = await scalar("select data from tasks where id='task-one'");
  assert.equal(saved.status, 'review');
  assert.equal(saved.comments.length, 1);
  assert.equal(saved.result.attachments.length, 1);
  assert.ok(saved.result.attachments[0].url.startsWith('sb://attachments/'));
  assert.equal(JSON.stringify(saved).includes('fixture-token'), false);
  assert.equal(await scalar('select count(*)::int from notifications'), 1);
});
test('HTTP Mini App login authenticates only the linked profile and reuses an already matching session', async () => {
  const f = endpointFixture();
  const values = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'http-login',
    user: JSON.stringify({ id: chats.one, email: 'wrong@example.invalid', role: 'head' }),
  });
  const key = createHmac('sha256', 'WebAppData').update('fixture-token').digest();
  values.set(
    'hash',
    createHmac('sha256', key)
      .update(
        [...values]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      )
      .digest('hex'),
  );
  const body = { action: 'mini_auth', initData: values.toString() };
  const response = await f.call(body, { authorization: 'Bearer existing-other' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.userId, ids.one);
  assert.equal(result.access_token, 'fixture-access');
  assert.deepEqual(f.authCalls, [ids.one + '@example.invalid']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await f.call(body)).status, 401);
  const reuse = await f.call(body, { authorization: 'Bearer existing-one' });
  assert.equal(reuse.status, 200);
  assert.equal((await reuse.json()).alreadyAuthenticated, true);
  const invalid = await f.call({ ...body, initData: values.toString().replace('http-login', 'forged') });
  assert.equal(invalid.status, 401);
  assert.equal(f.authCalls.length, 1);
});
