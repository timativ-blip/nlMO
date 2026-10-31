import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { appUrl, equalSecret, planConversation, splitText, validateInitData } from '../.test-telegram/telegram-entry.js';
const now = new Date('2026-10-31T22:30:00Z'); // 1 November in Moscow.
const me = { id: 'one', name: 'Координатор', role: 'coordinator', districtId: '118' };
const task = {
  id: 'tw_' + 'a'.repeat(32),
  title: 'Встреча с жителями',
  due: '2026-11-02',
  metricId: 'visitors',
  metricName: 'Участники',
  unit: 'чел.',
  revision: 'task-v1',
};
const report = {
  id: 'r_118_2026-10-26',
  districtId: '118',
  districtName: 'Первый округ',
  weekStart: '2026-10-26',
  conclusions: '',
  plan: '',
  problems: '',
  revision: 'report-v1',
};
const context = () => ({ userId: me.id, me, revision: 0, draft: null, tasks: [task], reports: [report], daily: [] });
function use(ctx, input) {
  const plan = planConversation(ctx, input, now);
  ctx.draft = plan.draft;
  ctx.revision++;
  return plan;
}
const click = (ctx, action, value) =>
  use(ctx, { callback: [action, ...(value === undefined ? [] : [value]), ctx.draft.nonce].join(':') });
const text = (plan) => plan.reply.map((r) => r.text).join('\n');
function signed(params, token = 'fixture-token') {
  const values = new URLSearchParams(params),
    data = [...values]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  values.set('hash', createHmac('sha256', key).update(data).digest('hex'));
  return values.toString();
}
test('Mini App HMAC validates signed identity, freshness and every query parameter', async () => {
  const params = {
    auth_date: String(+now / 1000),
    user: JSON.stringify({ id: 123, name: 'Fixture' }),
    query_id: 'q',
    signature: 'signed-extra-field',
  };
  assert.equal((await validateInitData(signed(params), 'fixture-token', +now)).id, 123);
  await assert.rejects(validateInitData(signed(params).replace('query_id=q', 'query_id=evil'), 'fixture-token', +now), /Подпись/);
  await assert.rejects(validateInitData(signed(params) + '&auth_date=1', 'fixture-token', +now), /Некорректные/);
  await assert.rejects(validateInitData(signed(params), 'wrong-token', +now), /Подпись/);
  await assert.rejects(
    validateInitData(signed({ ...params, auth_date: String(+now / 1000 - 601) }), 'fixture-token', +now),
    /устарели/,
  );
  await assert.rejects(
    validateInitData(signed({ ...params, auth_date: String(+now / 1000 + 60) }), 'fixture-token', +now),
    /устарели/,
  );
  await assert.rejects(validateInitData(signed({ ...params, user: '{"id":-1}' }), 'fixture-token', +now), /пользователя/);
  assert.equal(equalSecret('', ''), false);
});
test('mini app links stay on the website, preserve a safe route and carry no credentials', () => {
  const result = new URL(appUrl('https://example.org/app/?secret=no#old', '#/tasks/' + task.id));
  assert.equal(result.origin, 'https://example.org');
  assert.equal(result.hash, '');
  assert.equal(result.searchParams.get('view'), '/tasks/' + task.id);
  assert.equal(result.searchParams.has('secret'), false);
  assert.equal(new URL(appUrl('https://example.org/', '//evil.org')).searchParams.has('view'), false);
  assert.throws(() => appUrl('http://example.org/'), /HTTPS/);
});
test('daily dialog uses Moscow dates, preserves drafts, previews and requires explicit confirmation', () => {
  const ctx = context();
  use(ctx, { text: '/daily' });
  const dateButton = ctx.draft.nonce;
  assert.match(text(click(ctx, 'd', '2026-11-01')), /01.11.2026/);
  use(ctx, { text: 'Проведена встреча с жителями и подготовлен отчёт.' });
  use(ctx, { text: 'Подготовить публикацию' });
  const confirmation = use(ctx, { text: '-' });
  assert.equal(ctx.draft.stage, 'confirm');
  assert.equal(confirmation.operation, undefined);
  assert.match(text(confirmation), /Проведена встреча/);
  const before = structuredClone(ctx.draft);
  use(ctx, { text: '/weekly' });
  assert.deepEqual(ctx.draft, before);
  use(ctx, { callback: 'd:2026-11-01:' + dateButton });
  assert.deepEqual(ctx.draft, before);
  const submitted = click(ctx, 'confirm');
  assert.equal(submitted.operation.kind, 'submit');
  assert.equal(submitted.operation.nonce, before.nonce);
  assert.equal(ctx.draft, null);
});
test('result requires metric value, accepts materials and never confirms completion', () => {
  const ctx = context();
  use(ctx, { text: '/tasks' });
  click(ctx, 't', task.id);
  use(ctx, { text: 'Встреча проведена, присутствовало 12 человек.' });
  const nonce = ctx.draft.nonce;
  assert.match(text(use(ctx, { text: '-4' })), /неотрицательное/);
  assert.equal(ctx.draft.nonce, nonce);
  use(ctx, { text: '12,5' });
  use(ctx, { text: 'https://example.org/proof' });
  use(ctx, {
    attachment: { id: 'photo-1', kind: 'photo', name: 'Фото.jpg', url: 'sb://attachments/one/telegram/flow/photo.jpg' },
  });
  assert.equal(ctx.draft.attachments.length, 2);
  use(ctx, { text: '/done' });
  assert.equal(ctx.draft.stage, 'confirm');
  assert.match(text(click(ctx, 'confirm')), /на проверку/);
});
test('weekly report can be resumed and refreshed after a server conflict without losing entered text', () => {
  const ctx = context();
  use(ctx, { text: '/weekly' });
  click(ctx, 'w', report.id);
  use(ctx, { text: 'Итоги рабочей недели' });
  use(ctx, { text: '-' });
  use(ctx, { text: 'Провести новые встречи' });
  const draft = structuredClone(ctx.draft);
  assert.match(text(use(ctx, { text: '/resume' })), /Итоги рабочей/);
  assert.deepEqual(ctx.draft, draft);
  ctx.reports[0] = { ...report, conclusions: 'Новая версия с сайта', revision: 'report-v2' };
  const oldNonce = ctx.draft.nonce;
  const refreshed = click(ctx, 'refresh');
  assert.equal(ctx.draft.base, 'report-v2');
  assert.equal(ctx.draft.fields.conclusions, 'Итоги рабочей недели');
  assert.notEqual(ctx.draft.nonce, oldNonce);
  assert.match(text(refreshed), /Новая версия с сайта/);
});
test('unlinked users and members cannot open protected report flows; cancel leaves server records untouched', () => {
  const ctx = context();
  ctx.me = { ...me, role: 'member' };
  assert.match(text(use(ctx, { text: '/daily' })), /недоступен/);
  assert.equal(ctx.draft, null);
  ctx.me = null;
  assert.match(text(use(ctx, { text: '/tasks' })), /не подключена/);
  assert.equal(ctx.draft, null);
  ctx.me = me;
  use(ctx, { text: '/daily' });
  const result = use(ctx, { text: '/cancel' });
  assert.equal(result.draft, null);
  assert.equal(result.operation, undefined);
});
test('all messages and callback payloads fit Telegram limits, including long report previews', () => {
  const ctx = context();
  use(ctx, { text: '/weekly' });
  click(ctx, 'w', report.id);
  for (const value of ['Я'.repeat(3000), 'П'.repeat(3000), 'Н'.repeat(3000)]) use(ctx, { text: value });
  const preview = use(ctx, { text: '/resume' });
  assert.ok(preview.reply.length > 2);
  for (const msg of preview.reply) {
    assert.ok(msg.text.length <= 4096);
    for (const row of msg.buttons ?? [])
      for (const b of row) if (b.callback_data) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
  }
  const original = '😀'.repeat(3500);
  assert.equal(splitText(original).join(''), original);
});

test('a changed task metric requires a new value while retaining result text and materials', () => {
  const ctx = context();
  use(ctx, { text: '/tasks' });
  click(ctx, 't', task.id);
  use(ctx, { text: 'Проведена встреча и подготовлены материалы.' });
  use(ctx, { text: '12' });
  use(ctx, { text: 'https://example.org/proof' });
  use(ctx, { text: '/done' });
  ctx.tasks[0] = { ...task, metricId: 'other-metric', metricName: 'Новый показатель', revision: 'task-v2' };
  const refreshed = click(ctx, 'refresh');
  assert.equal(ctx.draft.stage, 'value');
  assert.equal(ctx.draft.fields.value, '');
  assert.match(ctx.draft.fields.text, /Проведена встреча/);
  assert.equal(ctx.draft.attachments.length, 1);
  assert.match(text(refreshed), /Новый показатель/);
});
