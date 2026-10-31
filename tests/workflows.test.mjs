import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMediaMatches,
  blankWorkflowBody,
  clearSavedDraft,
  draftKey,
  kpis,
  mediaSourceKey,
  nextOccurrence,
  readDraft,
  reportData,
  validateWorkflow,
  workflowTasks,
  writeDraft,
} from '../.test-workflows/workflows-entry.js';
const day = '2026-10-31';
const user = (id, role, districtId) => ({ id, name: id, role, districtId, active: true, pending: false });
const head = user('head', 'head', null),
  one = user('one', 'coordinator', '118'),
  two = user('two', 'coordinator', '119');
const state = () => ({
  users: [head, one, two],
  districts: [
    { id: '118', name: 'Первый' },
    { id: '119', name: 'Второй' },
  ],
  metrics: [],
  events: [],
  tasks: [],
  reports: [],
});
const body = { ...blankWorkflowBody(), title: 'Итоги недели', checklist: ['Подготовить', 'Опубликовать'] };
const targets = [
  { districtId: '118', assigneeId: 'one' },
  { districtId: '119', assigneeId: 'two' },
];

test('district tasks have independent checklists and reuse the ordinary report and KPI flow', () => {
  const s = state();
  validateWorkflow(body, targets, day, s, head, day);
  s.tasks = workflowTasks(body, targets, day, head, 'batch-1', day + 'T09:00:00Z');
  assert.equal(s.tasks.length, 2);
  assert.notEqual(s.tasks[0].id, s.tasks[1].id);
  assert.notEqual(s.tasks[0].checklist[0].id, s.tasks[1].checklist[0].id);
  s.tasks[0].checklist[0].done = true;
  assert.equal(s.tasks[1].checklist[0].done, false);
  s.tasks[0].status = 'done';
  s.tasks[0].confirmedAt = day;
  assert.equal(kpis(s, '2026-10-01', day).confirmed.length, 1);
  assert.equal(reportData(s, '118', '2026-10-26').tasks.length, 1);
  assert.equal(reportData(s, '119', '2026-10-26').tasks.length, 0);
});

test('validation rejects duplicate districts, foreign scopes and inactive assignees before creation', () => {
  assert.throws(() => validateWorkflow(body, targets, day, state(), one, day), /чужой округ/);
  assert.throws(() => validateWorkflow(body, [targets[0], targets[0]], day, state(), head, day), /без повторений/);
  const s = state();
  s.users[2].active = false;
  assert.throws(() => validateWorkflow(body, targets, day, s, head, day), /активного ответственного/);
});

test('weekly and monthly dates retain their original calendar anchor', () => {
  assert.equal(nextOccurrence('2026-10-31', 'weekly', '2026-11-02'), '2026-11-07');
  assert.equal(nextOccurrence('2026-10-31', 'monthly', '2026-10-31'), '2026-11-30');
  assert.equal(nextOccurrence('2026-10-31', 'monthly', '2026-11-30'), '2026-12-31');
  assert.equal(nextOccurrence('2028-01-31', 'monthly', '2028-01-31'), '2028-02-29');
});

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
test('draft text restores after reopening and is isolated by project, account, form and report day', () => {
  const store = storage(),
    initial = { text: '' };
  const key = draftKey('project', 'user', 'daily:2026-10-31');
  writeDraft(key, { text: 'Незавершённый отчёт' }, 'revision-1', store);
  assert.equal(readDraft(key, initial, store).value.text, 'Незавершённый отчёт');
  for (const foreign of [
    draftKey('other', 'user', 'daily:2026-10-31'),
    draftKey('project', 'other', 'daily:2026-10-31'),
    draftKey('project', 'user', 'daily:2026-10-30'),
    draftKey('project', 'user', 'result:123'),
  ])
    assert.equal(readDraft(foreign, initial, store), null);
  store.removeItem(key);
  assert.equal(readDraft(key, initial, store), null);
});

test('corrupt, incompatible, future or expired drafts cannot replace form data', () => {
  const store = storage(),
    key = 'draft';
  store.setItem(key, 'broken');
  assert.equal(readDraft(key, { text: '' }, store), null);
  store.setItem(key, JSON.stringify({ version: 1, at: Date.now(), value: { text: 5 } }));
  assert.equal(readDraft(key, { text: '' }, store), null);
  const at = writeDraft(key, { text: 'old' }, '', store);
  assert.equal(readDraft(key, { text: '' }, store, at + 31 * 864e5), null);
  assert.equal(readDraft(key, { text: '' }, store, at - 120000), null);
  assert.throws(
    () =>
      writeDraft(key, { text: 'keep me' }, '', {
        ...store,
        setItem: () => {
          throw Error('quota');
        },
      }),
    /quota/,
  );
});

test('a delayed acknowledgement cannot delete text edited after submission or another form draft', () => {
  const store = storage(),
    key = draftKey('project', 'user', 'daily:2026-10-31');
  const sent = { text: 'Отправленная версия' },
    newer = { text: 'Добавлено после отправки' };
  writeDraft(key, sent, '', store);
  writeDraft(key, newer, '', store);
  assert.equal(clearSavedDraft(key, sent, store), false);
  assert.deepEqual(readDraft(key, { text: '' }, store).value, newer);
  const other = draftKey('project', 'user', 'daily:2026-10-30');
  writeDraft(other, sent, '', store);
  assert.equal(clearSavedDraft(other, sent, store), true);
  assert.deepEqual(readDraft(key, { text: '' }, store).value, newer);
  assert.equal(clearSavedDraft(key, newer, store), true);
  assert.equal(readDraft(key, { text: '' }, store), null);
});

const post = (author) => [day, 'Пост', 'Канал', 'vk', author, 10, 1, 200, 2, 0, 0, 0, 'https://example.org/' + author, 1, ''];
const data = () => ({
  groups: [
    { id: '118', num: 118, name: 'Первый' },
    { id: '119', num: 119, name: 'Второй' },
  ],
  people: [
    ['Иванов Иван', '118'],
    ['Псевдоним', 'none'],
    ['Другой псевдоним', 'none'],
    ['Из документа', '119'],
  ],
  posts: [post(0), post(1), post(2), post(3)],
  updated: 'now',
});
const users = [{ ...one, id: 'ivan', name: 'Иван Иванов' }];
const match = (name, overrides = {}) => ({
  id: mediaSourceKey(name),
  sourceName: name,
  groupId: '118',
  userId: 'ivan',
  active: true,
  ownerId: 'head',
  ...overrides,
});
test('manual media aliases merge into the existing author without duplicating posts, points or roster', () => {
  const original = data(),
    before = JSON.stringify(original);
  const resolved = applyMediaMatches(original, [match('Псевдоним'), match('Другой псевдоним')], users);
  assert.deepEqual(
    resolved.posts.map((p) => p[4]),
    [0, 0, 0, 3],
  );
  assert.equal(resolved.posts.length, 4);
  assert.equal(
    resolved.posts.reduce((n, p) => n + p[5], 0),
    40,
  );
  assert.equal(resolved.people.filter((p) => p[1] === '118').length, 1);
  assert.equal(JSON.stringify(original), before);
});

test('source document assignments have priority and removing a match restores the source view', () => {
  const original = data();
  const resolved = applyMediaMatches(original, [match('Из документа')], users);
  assert.deepEqual(resolved.people[3], original.people[3]);
  assert.deepEqual(applyMediaMatches(original, [match('Псевдоним', { active: false })], users), original);
  assert.deepEqual(applyMediaMatches(original, [match('Псевдоним')], [{ ...users[0], active: false }]), original);
});
