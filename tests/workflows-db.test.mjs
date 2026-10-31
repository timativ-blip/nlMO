import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let db, today;
const ids = {
  head: '00000000-0000-0000-0000-000000000001',
  c1: '00000000-0000-0000-0000-000000000002',
  c2: '00000000-0000-0000-0000-000000000003',
  member: '00000000-0000-0000-0000-000000000004',
  staff: '00000000-0000-0000-0000-000000000005',
};
const body = {
  title: 'Публикация итогов недели',
  description: 'Текст и ссылка на результат',
  priority: 'normal',
  checklist: ['Подготовить', 'Опубликовать'],
  links: ['https://example.org'],
  metricId: null,
  eventId: null,
};
const targets = [
  { districtId: '118', assigneeId: ids.c1 },
  { districtId: '119', assigneeId: ids.c2 },
];
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
async function actor(id, fn) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}
const launch = (id = 'request-0001', options = {}) =>
  scalar('select public.launch_task_workflow($1,$2::jsonb,$3::jsonb,$4,$5::jsonb)', [
    id,
    JSON.stringify(options.body ?? body),
    JSON.stringify(options.targets ?? targets),
    options.due ?? today,
    options.repeat ? JSON.stringify(options.repeat) : null,
  ]);

before(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create schema extensions; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;",
  );
  const initial = readFileSync(new URL('../supabase/migrations/001_init.sql', import.meta.url), 'utf8');
  const baseline = initial
    .slice(initial.indexOf('create table profiles'), initial.indexOf('-- Хранилище вложений'))
    .replace(/select cron\.schedule\([^;]+;/g, '')
    .replace(/alter publication supabase_realtime[^;]+;/g, '');
  await db.exec(baseline);
  await db.exec(
    'grant select,insert,update on public.tasks,public.events,public.profiles,public.districts,public.metrics,public.notifications to authenticated',
  );
  await db.exec(readFileSync(new URL('../supabase/migrations/20261031155734_task_workflows.sql', import.meta.url), 'utf8'));
  for (const [key, id] of Object.entries(ids)) {
    await db.query('insert into auth.users(id) values($1)', [id]);
    const role = key === 'head' ? 'head' : key === 'staff' ? 'staff' : key === 'member' ? 'member' : 'coordinator';
    await db.query('insert into profiles(id,data) values($1,$2::jsonb)', [
      id,
      JSON.stringify({
        id,
        name: key,
        role,
        active: true,
        pending: false,
        districtId: key === 'c2' ? '119' : key === 'c1' || key === 'member' ? '118' : null,
      }),
    ]);
  }
  for (const id of ['118', '119'])
    await db.query('insert into districts(id,data) values($1,$2::jsonb)', [
      id,
      JSON.stringify({ id, name: id, coordinatorId: id === '118' ? ids.c1 : ids.c2 }),
    ]);
  today = await scalar("select (now() at time zone 'Europe/Moscow')::date::text");
});
beforeEach(async () => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec('truncate tasks,task_templates,task_schedules,media_matches,task_workflow_requests,notifications,audit_log');
  await db.query("update profiles set data=jsonb_set(data,'{active}','true')");
});
after(async () => {
  await db?.close();
});

test('a district assignment creates separate ordinary tasks and one notification per task', async () => {
  const result = await actor(ids.head, () => launch());
  assert.equal(result.tasks.length, 2);
  assert.notEqual(result.tasks[0].id, result.tasks[1].id);
  assert.deepEqual(
    result.tasks.map((t) => t.status),
    ['new', 'new'],
  );
  assert.ok(
    result.tasks.every(
      (t) => t.authorId === ids.head && t.checklist.length === 2 && t.attachments.length === 1 && t.result === null,
    ),
  );
  assert.equal(await scalar('select count(*)::int from notifications'), 2);
  assert.equal(await scalar("select count(*)::int from audit_log where entity='tasks'"), 2);
});

test('retrying a request returns the same tasks and rejects changed payloads', async () => {
  const first = await actor(ids.head, () => launch());
  const again = await actor(ids.head, () => launch());
  assert.deepEqual(
    first.tasks.map((t) => t.id),
    again.tasks.map((t) => t.id),
  );
  assert.equal(await scalar('select count(*)::int from tasks'), 2);
  assert.equal(await scalar('select count(*)::int from notifications'), 2);
  await assert.rejects(
    actor(ids.head, () => launch('request-0001', { body: { ...body, title: 'Изменённое поручение' } })),
    /Параметры/,
  );
});

test('coordinators cannot assign other districts; failed validation leaves no partial tasks', async () => {
  await assert.rejects(
    actor(ids.c1, () => launch()),
    /чужой округ/,
  );
  assert.equal(await scalar('select count(*)::int from tasks'), 0);
  assert.equal(await scalar('select count(*)::int from notifications'), 0);
  const own = await actor(ids.c1, () => launch('request-own1', { targets: [targets[0]] }));
  assert.equal(own.tasks.length, 1);
  await assert.rejects(
    actor(ids.member, () => launch('request-own2', { targets: [targets[0]] })),
    /Недостаточно прав/,
  );
});

test('an error during the second insert rolls back tasks, receipts and notifications', async () => {
  await db.exec(
    "create function app_private.test_fail_second() returns trigger language plpgsql as $$begin if new.data->>'districtId'='119' then raise exception 'test second insert';end if;return new;end$$;create trigger test_failure before insert on tasks for each row execute function app_private.test_fail_second();",
  );
  await assert.rejects(
    actor(ids.head, () => launch()),
    /test second insert/,
  );
  assert.equal(await scalar('select count(*)::int from tasks'), 0);
  assert.equal(await scalar('select count(*)::int from notifications'), 0);
  assert.equal(await scalar('select count(*)::int from task_workflow_requests'), 0);
  await db.exec('drop trigger test_failure on tasks;drop function app_private.test_fail_second()');
});

test('batch tasks retain the old start → review → independent confirmation rules', async () => {
  const result = await actor(ids.head, () => launch());
  const id = result.tasks[0].id;
  await actor(ids.c1, () => db.query('update tasks set data=data||\'{"status":"in_progress"}\'::jsonb where id=$1', [id]));
  await actor(ids.c1, () =>
    db.query(
      "update tasks set data=data||jsonb_build_object('status','review','result',jsonb_build_object('text','Опубликован подробный результат','attachments','[]'::jsonb)) where id=$1",
      [id],
    ),
  );
  await assert.rejects(
    actor(ids.c1, () => db.query('update tasks set data=data||\'{"status":"done"}\'::jsonb where id=$1', [id])),
    /не по своей задаче/,
  );
  await actor(ids.head, () => db.query('update tasks set data=data||\'{"status":"done"}\'::jsonb where id=$1', [id]));
  const stored = await scalar('select data from tasks where id=$1', [id]);
  assert.equal(stored.status, 'done');
  assert.equal(stored.confirmedAt, today);
  assert.equal(stored.confirmedBy, ids.head);
  assert.equal(await scalar("select data->>'status' from tasks where id=$1", [result.tasks[1].id]), 'new');
});

test('templates are personal unless explicitly shared; other users cannot edit them', async () => {
  const template = {
    id: 'template-1',
    name: 'Шаблон штаба',
    ownerId: ids.staff,
    body,
    deadlineDays: 3,
    shared: false,
    archived: false,
  };
  await actor(ids.staff, () =>
    db.query('insert into task_templates(id,data) values($1,$2::jsonb)', [template.id, JSON.stringify(template)]),
  );
  assert.equal(await actor(ids.c1, () => scalar('select count(*)::int from task_templates')), 0);
  await actor(ids.staff, () =>
    db.query("update task_templates set data=jsonb_set(data,'{shared}','true') where id='template-1'"),
  );
  assert.equal(await actor(ids.c1, () => scalar('select count(*)::int from task_templates')), 1);
  const edit = await actor(ids.c1, () =>
    db.query("update task_templates set data=jsonb_set(data,'{name}','\"Чужая правка\"') where id='template-1' returning id"),
  );
  assert.equal(edit.rows.length, 0);
  assert.equal(await actor(ids.member, () => scalar('select count(*)::int from task_templates')), 0);
});

test('monthly repeats clamp to the month end without losing the original anchor day', async () => {
  assert.equal(await scalar("select app_private.next_task_occurrence('2026-10-31','monthly','2026-10-31')::text"), '2026-11-30');
  assert.equal(await scalar("select app_private.next_task_occurrence('2026-10-31','monthly','2026-11-30')::text"), '2026-12-31');
  assert.equal(await scalar("select app_private.next_task_occurrence('2028-01-31','monthly','2028-01-31')::text"), '2028-02-29');
});

test('a due schedule runs once on the server without a browser and can be paused', async () => {
  const future = await scalar('select ($1::date+1)::text', [today]);
  const result = await actor(ids.head, () =>
    launch('request-repeat', { repeat: { frequency: 'weekly', start: future, time: '00:00', deadlineDays: 3 } }),
  );
  assert.equal(result.tasks.length, 0);
  assert.ok(result.schedule);
  await db.query("update task_schedules set data=jsonb_set(data,'{nextRun}',to_jsonb($2::text)) where id=$1", [
    result.schedule.id,
    today,
  ]);
  assert.equal(await scalar('select app_private.run_task_schedules()'), 2);
  assert.equal(await scalar('select app_private.run_task_schedules()'), 0);
  assert.equal(await scalar('select count(*)::int from notifications'), 2);
  await actor(ids.head, () =>
    db.query("update task_schedules set data=jsonb_set(data,'{enabled}','false') where id=$1", [result.schedule.id]),
  );
  assert.equal(await scalar('select app_private.run_task_schedules()'), 0);
});

test('a disabled owner stops recurrence without creating tasks or weakening old permissions', async () => {
  const future = await scalar('select ($1::date+1)::text', [today]);
  const result = await actor(ids.staff, () =>
    launch('request-disabled', { repeat: { frequency: 'weekly', start: future, time: '00:00', deadlineDays: 3 } }),
  );
  await db.query("update task_schedules set data=jsonb_set(data,'{nextRun}',to_jsonb($2::text)) where id=$1", [
    result.schedule.id,
    today,
  ]);
  await db.query("update profiles set data=jsonb_set(data,'{active}','false') where id=$1", [ids.staff]);
  assert.equal(await scalar('select app_private.run_task_schedules()'), 0);
  const job = await scalar('select data from task_schedules where id=$1', [result.schedule.id]);
  assert.equal(job.enabled, false);
  assert.match(job.lastError, /Недостаточно прав/);
  assert.equal(await scalar('select count(*)::int from tasks'), 0);
});

test('catching up after downtime creates one current batch with fresh deadlines', async () => {
  const future = await scalar('select ($1::date+1)::text', [today]);
  const result = await actor(ids.head, () =>
    launch('request-catchup', { repeat: { frequency: 'weekly', start: future, time: '00:00', deadlineDays: 4 } }),
  );
  await db.query(
    "update task_schedules set data=jsonb_set(jsonb_set(data,'{nextRun}',to_jsonb(($2::date-28)::text)),'{rule,start}',to_jsonb(($2::date-35)::text)) where id=$1",
    [result.schedule.id, today],
  );
  assert.equal(await scalar('select app_private.run_task_schedules()'), 2);
  assert.equal(await scalar('select app_private.run_task_schedules()'), 0);
  const due = await scalar('select ($1::date+4)::text', [today]);
  assert.equal(await scalar("select count(*)::int from tasks where data->>'due'=$1", [due]), 2);
  assert.ok((await scalar('select data from task_schedules where id=$1', [result.schedule.id])).nextRun > today);
});

test('an inactive assignee pauses the whole scheduled batch without partial tasks', async () => {
  const future = await scalar('select ($1::date+1)::text', [today]);
  const result = await actor(ids.head, () =>
    launch('request-assignee', { repeat: { frequency: 'weekly', start: future, time: '00:00', deadlineDays: 3 } }),
  );
  await db.query("update task_schedules set data=jsonb_set(data,'{nextRun}',to_jsonb($2::text)) where id=$1", [
    result.schedule.id,
    today,
  ]);
  await db.query("update profiles set data=jsonb_set(data,'{active}','false') where id=$1", [ids.c2]);
  assert.equal(await scalar('select app_private.run_task_schedules()'), 0);
  assert.equal(await scalar('select count(*)::int from tasks'), 0);
  assert.equal(await scalar('select count(*)::int from notifications'), 0);
  assert.equal((await scalar('select data from task_schedules where id=$1', [result.schedule.id])).enabled, false);
});

test('malformed schedules and templates cannot enter the shared database', async () => {
  const future = await scalar('select ($1::date+1)::text', [today]);
  for (const rule of [
    { frequency: 'weekly', start: future, time: '00:00' },
    { frequency: 'monthly', start: null, time: '00:00', deadlineDays: 3 },
    { frequency: 'weekly', start: future, time: '27:00', deadlineDays: 3 },
  ]) {
    await assert.rejects(
      actor(ids.head, () => launch('request-invalid', { repeat: rule })),
      /Проверьте/,
    );
  }
  const document = {
    id: 'invalid-schedule',
    body,
    targets,
    rule: { frequency: 'weekly', start: null, time: '00:00', deadlineDays: 3 },
    nextRun: future,
    enabled: true,
  };
  await assert.rejects(
    actor(ids.head, () =>
      db.query('insert into task_schedules(id,data) values($1,$2::jsonb)', [document.id, JSON.stringify(document)]),
    ),
    /Проверьте/,
  );
  const template = {
    id: 'bad-template',
    name: 'Неверный шаблон',
    body: { ...body, checklist: [17] },
    deadlineDays: 3,
    shared: false,
    archived: false,
  };
  await assert.rejects(
    actor(ids.head, () =>
      db.query('insert into task_templates(id,data) values($1,$2::jsonb)', [template.id, JSON.stringify(template)]),
    ),
    /пункт чек-листа/,
  );
  assert.equal(await scalar('select count(*)::int from task_schedules'), 0);
  assert.equal(await scalar('select count(*)::int from task_workflow_requests'), 0);
});

test('media mappings enforce district rights and require the selected person to belong to that district', async () => {
  const match = { id: 'media:новый автор', sourceName: 'Новый Автор', groupId: '118', userId: ids.member, active: true };
  await actor(ids.c1, () =>
    db.query('insert into media_matches(id,data) values($1,$2::jsonb)', [match.id, JSON.stringify(match)]),
  );
  const changed = await actor(ids.c2, () =>
    db.query("update media_matches set data=jsonb_set(data,'{groupId}','\"119\"') where id=$1 returning id", [match.id]),
  );
  assert.equal(changed.rows.length, 0);
  await assert.rejects(
    actor(ids.head, () =>
      db.query("update media_matches set data=jsonb_set(data,'{groupId}','\"119\"') where id=$1", [match.id]),
    ),
    /Человек должен/,
  );
  assert.equal(await actor(ids.member, () => scalar('select count(*)::int from media_matches')), 1);
});

test('the scheduler and anonymous access cannot be called through the public API', async () => {
  await assert.rejects(
    actor(ids.head, () => scalar('select app_private.run_task_schedules()')),
    /permission denied/,
  );
  await db.exec('set role anon');
  try {
    await assert.rejects(db.query('select * from media_matches'), /permission denied/);
    await assert.rejects(launch(), /permission denied/);
  } finally {
    await db.exec('reset role');
  }
});

test('media source keys normalize capital Ё and repeated spaces consistently with the client', async () => {
  const match = { id: 'media:ежова елена', sourceName: '  Ёжова   Елена  ', groupId: '118', userId: null, active: true };
  await actor(ids.c1, () =>
    db.query('insert into media_matches(id,data) values($1,$2::jsonb)', [match.id, JSON.stringify(match)]),
  );
  assert.equal(await actor(ids.c1, () => scalar('select count(*)::int from media_matches')), 1);
});
