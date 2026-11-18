import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
let db;
const ids = {
  head: "00000000-0000-0000-0000-000000000001",
  coord: "00000000-0000-0000-0000-000000000002",
  other: "00000000-0000-0000-0000-000000000003",
  member: "00000000-0000-0000-0000-000000000004",
  recipient: "00000000-0000-0000-0000-000000000005",
};
const scalar = async (sql, args = []) =>
  Object.values((await db.query(sql, args)).rows[0])[0];
async function as(uid, fn, role = "authenticated") {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    uid ?? "",
  ]);
  await db.exec("set role " + role);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
const call = (who, action, body = {}) =>
  as(who, () =>
    scalar("select public.headquarters($1,$2::jsonb)", [
      action,
      JSON.stringify(body),
    ]),
  );
const mutation = (who, action, body = {}) =>
  call(who, action, { requestId: randomUUID(), ...body });
const resource = async (kind = "equipment") =>
  mutation(ids.head, "resource_save", {
    kind,
    name: "Камера",
    code: "К-01",
    description: "",
  });
const reserve = async (r, who = ids.coord, extra = {}) =>
  mutation(who, "reserve", {
    resourceId: r.id,
    startsAt: new Date(Date.now() + 1000).toISOString(),
    endsAt: new Date(Date.now() + 7200000).toISOString(),
    purpose: "Съёмка на округе",
    ...extra,
  });
const content = {
  agenda: "Повестка",
  summary: "Обсудили работу",
  decisions: "Принято решение",
  actions: "Срок не указан",
};
const minutes = (extra = {}) =>
  mutation(ids.coord, "minutes_save", {
    id: randomUUID(),
    title: "Планёрка округа",
    heldAt: new Date().toISOString(),
    responsibleId: ids.coord,
    content,
    attachments: [],
    participantIds: [ids.other],
    ...extra,
  });
before(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema extensions;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;create schema net;create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer default 5000) returns bigint language sql as $$select 1::bigint$$;",
  );
  await db.exec(
    "create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;",
  );
  const sql = readFileSync(
    new URL("../supabase/migrations/001_init.sql", import.meta.url),
    "utf8",
  );
  await db.exec(
    sql
      .slice(
        sql.indexOf("create table profiles"),
        sql.indexOf("-- Хранилище вложений"),
      )
      .replace(/select cron\.schedule\([^;]+;/g, "")
      .replace(/alter publication supabase_realtime[^;]+;/g, ""),
  );
  for (const file of [
    "20261102075931_communications_and_meetings.sql",
    "20261102100858_meeting_scheduling_notifications.sql",
    "20261102110233_meeting_minutes.sql",
    "20261111072559_headquarters_workspace.sql",
    "20261118090000_inventory_quantities.sql",
    "20261118090100_budget_expenses.sql",
    "20261118090200_ticktick_sync.sql",
  ])
    await db.exec(
      readFileSync(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ).replace(/select cron\.schedule\([^;]+;/g, ""),
    );
  await db.exec(
    "grant usage on schema public to authenticated,anon,service_role;grant select,update on public.profiles to authenticated;",
  );
  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,data) values($1,$2::jsonb)",
      [
        id,
        JSON.stringify({
          id,
          name,
          role:
            name === "head"
              ? "head"
              : name === "member"
                ? "member"
                : "coordinator",
          districtId: "121",
          active: true,
          pending: false,
        }),
      ],
    );
  }
  await db.query("insert into districts values($1,$2)", [
    "121",
    '{"id":"121","name":"Округ"}',
  ]);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261118090300_leadership_access.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec(
    "truncate hq_private.requests,hq_private.ai_jobs,public.hq_reservations,public.hq_minutes_archive,notifications,public.budget_expenses,public.budget_advances,public.budget_requests,public.budget_funds,public.ticktick_connections,public.ticktick_oauth_states,storage.objects;",
  );
  await db.query(
    'update profiles set data=data||\'{"active":true,"pending":false}\'::jsonb',
  );
});
after(async () => db.close());
test("only approved working roles enter HQ; no anonymous or direct writes", async () => {
  await assert.rejects(call(ids.member, "index"), /Кабинет доступен/);
  await assert.rejects(
    as(ids.member, () => scalar("select public.communications('index','{}')")),
    /Войдите/,
  );
  await assert.rejects(
    as(null, () => scalar("select public.headquarters('index','{}')"), "anon"),
    /permission denied/,
  );
  await assert.rejects(
    as(ids.coord, () =>
      db.exec("insert into hq_resources(kind,name)values('room','Подмена')"),
    ),
    /permission denied/,
  );
  await db.query(
    "update profiles set data=data||'{\"pending\":true}' where id=$1",
    [ids.coord],
  );
  await assert.rejects(call(ids.coord, "index"), /Кабинет доступен/);
});
test("resources are managed by HQ; reservation conflicts and adjacency are enforced centrally", async () => {
  await assert.rejects(
    mutation(ids.coord, "resource_save", { kind: "equipment", name: "Камера" }),
    /Каталог/,
  );
  const r = await resource();
  const a = await reserve(r);
  await assert.rejects(reserve(r, ids.other), /уже есть бронь/);
  await reserve(r, ids.other, {
    startsAt: a.ends_at,
    endsAt: new Date(Date.parse(a.ends_at) + 3600000).toISOString(),
  });
  assert.equal(await scalar("select count(*)::int from hq_reservations"), 2);
});
test("retry after lost response returns one booking; request reuse with altered content is rejected", async () => {
  const r = await resource(),
    requestId = randomUUID(),
    body = {
      resourceId: r.id,
      startsAt: new Date(Date.now() + 1000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      purpose: "Съёмка округа",
      requestId,
    };
  const a = await call(ids.coord, "reserve", body),
    b = await call(ids.coord, "reserve", body);
  assert.deepEqual(a, b);
  await assert.rejects(
    call(ids.coord, "reserve", { ...body, purpose: "Подмена" }),
    /уже использован/,
  );
  assert.equal(await scalar("select count(*)::int from hq_reservations"), 1);
});
test("borrower self-records actual issue and return; another employee cannot; stale version is rejected", async () => {
  const r = await resource(),
    b = await reserve(r);
  await assert.rejects(
    mutation(ids.other, "reservation_update", {
      id: b.id,
      version: 1,
      status: "issued",
    }),
    /Нет доступа/,
  );
  const issued = await mutation(ids.coord, "reservation_update", {
    id: b.id,
    version: 1,
    status: "issued",
    note: "Комплект полный",
  });
  assert.ok(issued.issued_at);
  assert.equal(issued.updated_by, ids.coord);
  await assert.rejects(
    mutation(ids.coord, "reservation_update", {
      id: b.id,
      version: 1,
      status: "returned",
    }),
    /уже изменилась/,
  );
  const returned = await mutation(ids.coord, "reservation_update", {
    id: b.id,
    version: issued.version,
    status: "returned",
    note: "Всё цело",
  });
  assert.ok(returned.returned_at);
  assert.equal(returned.return_note, "Всё цело");
  await reserve(r, ids.other);
});
test("overdue physical issue blocks future reservation until return; expired reservation cannot be received", async () => {
  const r = await resource(),
    b = await reserve(r);
  await mutation(ids.coord, "reservation_update", {
    id: b.id,
    version: 1,
    status: "issued",
  });
  await db.query(
    "update hq_reservations set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where id=$1",
    [b.id],
  );
  await assert.rejects(
    reserve(r, ids.other, {
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
    }),
    /не возвращено/,
  );
  await db.query("update hq_reservations set status='reserved' where id=$1", [
    b.id,
  ]);
  await assert.rejects(
    mutation(ids.coord, "reservation_update", {
      id: b.id,
      version: 2,
      status: "issued",
    }),
    /окончания брони/,
  );
});
test("room issue is forbidden; cancelling frees its slot and notifies once", async () => {
  const r = await resource("room"),
    b = await reserve(r);
  await assert.rejects(
    mutation(ids.coord, "reservation_update", {
      id: b.id,
      version: 1,
      status: "issued",
    }),
    /недоступно/,
  );
  await mutation(ids.coord, "reservation_update", {
    id: b.id,
    version: 1,
    status: "cancelled",
  });
  await reserve(r, ids.other);
});
test("draft minutes are private to editors, published snapshot stays stable after edits", async () => {
  const d = await minutes();
  assert.equal((await call(ids.other, "index")).minutes.length, 0);
  const pub = await mutation(ids.coord, "minutes_publish", {
    id: d.id,
    version: 1,
  });
  assert.equal(pub.published_version, 1);
  const read = (await call(ids.other, "index")).minutes[0];
  assert.equal(read.can_edit, false);
  assert.equal(read.content.summary, content.summary);
  await minutes({
    id: d.id,
    version: 1,
    content: { ...content, summary: "Неопубликованный секрет" },
  });
  assert.equal(
    (await call(ids.other, "index")).minutes[0].content.summary,
    content.summary,
  );
  await assert.rejects(
    mutation(ids.other, "minutes_save", { id: d.id }),
    /Нет доступа/,
  );
  await assert.rejects(
    as(ids.other, () => scalar("select count(*) from hq_minutes_archive")),
    /permission denied/,
  );
});
test("delegated responsible can edit; publication has deduplicated recipient notices", async () => {
  const d = await minutes({ responsibleId: ids.other }),
    body = { id: d.id, version: 1, requestId: randomUUID() };
  await call(ids.other, "minutes_publish", body);
  await call(ids.other, "minutes_publish", body);
  await mutation(ids.other, "minutes_publish", { id: d.id, version: 1 });
  assert.equal(await scalar("select count(*)::int from notifications"), 2);
  await assert.rejects(
    mutation(ids.coord, "minutes_publish", { id: d.id, version: 0 }),
    /изменился/,
  );
});
test("malicious materials links are refused and only HQ edits folder catalog", async () => {
  await assert.rejects(
    mutation(ids.coord, "material_save", {
      kind: "link",
      name: "Файл",
      url: "https://example.org",
    }),
    /штаб/,
  );
  for (const url of [
    "javascript:alert(1)",
    "http://example.org",
    "https://x@y.com/",
  ])
    await assert.rejects(
      mutation(ids.head, "material_save", { kind: "link", name: "Файл", url }),
      /безопасную/,
    );
  const m = await mutation(ids.head, "material_save", {
    kind: "folder",
    name: "Шаблоны",
  });
  await mutation(ids.head, "material_save", {
    kind: "link",
    name: "Документ",
    parentId: m.id,
    url: "https://docs.google.com/document/d/example",
  });
});
test("AI permission and quota are checked server-side and outputs cached without transcript", async () => {
  const d = await minutes(),
    body = { archiveId: d.id, requestId: randomUUID(), hash: "a".repeat(64) };
  await assert.rejects(call(ids.other, "ai_begin", body), /Нет доступа/);
  assert.equal((await call(ids.coord, "ai_begin", body)).claimed, true);
  assert.equal((await call(ids.coord, "ai_begin", body)).busy, true);
  await as(
    null,
    () =>
      scalar("select public.headquarters_ai_complete($1,$2,$3::jsonb)", [
        body.requestId,
        ids.coord,
        JSON.stringify(content),
      ]),
    "service_role",
  );
  assert.deepEqual((await call(ids.coord, "ai_begin", body)).content, content);
  for (let i = 1; i < 10; i++)
    await call(ids.coord, "ai_begin", { ...body, requestId: randomUUID() });
  await assert.rejects(
    call(ids.coord, "ai_begin", { ...body, requestId: randomUUID() }),
    /Лимит/,
  );
  await assert.rejects(
    as(ids.coord, () =>
      scalar("select public.headquarters_ai_complete($1,$2,null)", [
        body.requestId,
        ids.coord,
      ]),
    ),
    /permission denied/,
  );
});

test("draft protocol files are isolated; recipients read only published attachments and cannot launder inaccessible files into another archive", async () => {
  const path = ids.coord + "/" + randomUUID() + ".txt",
    attachment = {
      id: randomUUID(),
      name: "Протокол.txt",
      kind: "file",
      url: "sb://meeting-protocols/" + path,
    };
  await as(ids.coord, () =>
    db.query(
      "insert into storage.objects(bucket_id,name)values('meeting-protocols',$1)",
      [path],
    ),
  );
  assert.equal(
    await as(ids.other, () =>
      scalar("select count(*)::int from storage.objects where name=$1", [path]),
    ),
    0,
  );
  await assert.rejects(
    mutation(ids.other, "minutes_save", {
      id: randomUUID(),
      title: "Чужой файл",
      heldAt: new Date().toISOString(),
      responsibleId: ids.other,
      content,
      attachments: [attachment],
      participantIds: [],
    }),
    /Нет доступа к прикреплённому файлу/,
  );
  const d = await minutes({
    attachments: [attachment],
    participantIds: [ids.recipient],
  });
  assert.equal(
    await as(ids.recipient, () =>
      scalar("select count(*)::int from storage.objects where name=$1", [path]),
    ),
    0,
  );
  await mutation(ids.coord, "minutes_publish", { id: d.id, version: 1 });
  assert.equal(
    await as(ids.recipient, () =>
      scalar("select count(*)::int from storage.objects where name=$1", [path]),
    ),
    1,
  );
  const draftPath = ids.coord + "/" + randomUUID() + ".txt";
  await as(ids.coord, () =>
    db.query(
      "insert into storage.objects(bucket_id,name)values('meeting-protocols',$1)",
      [draftPath],
    ),
  );
  await minutes({
    id: d.id,
    version: 1,
    attachments: [
      { ...attachment, url: "sb://meeting-protocols/" + draftPath },
    ],
    participantIds: [ids.recipient],
  });
  assert.equal(
    await as(ids.recipient, () =>
      scalar("select count(*)::int from storage.objects where name=$1", [
        draftPath,
      ]),
    ),
    0,
  );
  assert.equal(
    await as(ids.recipient, () =>
      scalar("select count(*)::int from storage.objects where name=$1", [path]),
    ),
    1,
  );
});

test("early pickup cannot occupy the preceding employees reserved interval", async () => {
  const r = await resource();
  const first = await reserve(r, ids.coord, {
    endsAt: new Date(Date.now() + 15 * 60000).toISOString(),
  });
  const second = await reserve(r, ids.other, {
    startsAt: first.ends_at,
    endsAt: new Date(Date.parse(first.ends_at) + 3600000).toISOString(),
  });
  await assert.rejects(
    mutation(ids.other, "reservation_update", {
      id: second.id,
      version: 1,
      status: "issued",
    }),
    /действует его бронь/,
  );
});

test("inventory capacity is the maximum overlap; attributes and legacy single items are preserved", async () => {
  const item = await mutation(ids.head, "resource_save", {
    kind: "equipment", name: "Футболка", size: "L", color: "Синяя", quantity: 4,
  });
  assert.deepEqual([item.size, item.color, item.quantity], ["L", "Синяя", 4]);
  const now = Date.now();
  const starts = (h) => new Date(now + h*3600000).toISOString();
  await reserve(item, ids.coord, { quantity: 2, startsAt: starts(1), endsAt: starts(2) });
  await reserve(item, ids.other, { quantity: 2, startsAt: starts(2), endsAt: starts(3) });
  const spanning = await reserve(item, ids.recipient, { quantity: 2, startsAt: starts(1), endsAt: starts(3) });
  assert.equal(spanning.quantity, 2);
  await assert.rejects(reserve(item, ids.other, { quantity: 1, startsAt: starts(2), endsAt: starts(2.5) }), /недостаточно/);
  await assert.rejects(mutation(ids.head, "resource_save", { id: item.id, kind: "equipment", name: item.name, quantity: 3 }), /уже забронирована/);
  assert.equal((await resource()).quantity, 1);
  await assert.rejects(as(ids.coord, () => scalar("select hq_private.dispatch('reserve','{}')")), /permission denied/);
});

const budget = (who, action, body) => as(who, () => scalar(
  "select public.budget($1,$2)", [action, { requestId: randomUUID(), ...body }],
));
const currentDay = () => scalar("select public.msk_today()");
test("budget request, payment, receipt return, resubmit and approval respect roles and balance", async () => {
  const fund = await budget(ids.head, "fund_save", { id: randomUUID(), kind: "district", districtId: "121", name: "Округ № 121", limitMinor: 2000000 });
  const media = await budget(ids.head, "fund_save", { id: randomUUID(), kind: "media", name: "Медиа", limitMinor: 500000 });
  assert.equal(await as(ids.coord, () => scalar("select count(*)::int from budget_funds")), 1);
  await assert.rejects(budget(ids.coord, "request", { id: randomUUID(), fundId: media.id, amountMinor: 1000000, purpose: "Материалы" }), /недоступен/);
  await assert.rejects(budget(ids.coord, "fund_save", { id: randomUUID() }), /руководство/);
  const request = await budget(ids.coord, "request", { id: randomUUID(), fundId: fund.id, amountMinor: 1000000, purpose: "Материалы" });
  assert.equal(request.status, "pending");
  assert.equal(await as(ids.other, () => scalar("select count(*)::int from budget_requests")), 0);
  assert.equal(await scalar("select issued_minor::int from budget_funds where id=$1", [fund.id]), 0);
  const date = await currentDay();
  await assert.rejects(budget(ids.coord, "mark_sent", { id: request.id, date }), /руководство/);
  const sent = await budget(ids.head, "mark_sent", { id: request.id, date, note: "Перевод выполнен" });
  assert.equal(sent.request_id, request.id);
  assert.equal(await scalar("select issued_minor::int from budget_funds where id=$1", [fund.id]), 1000000);
  await assert.rejects(budget(ids.head, "mark_sent", { id: request.id, date }), /уже принято/);
  const over = await budget(ids.coord, "request", { id: randomUUID(), fundId: fund.id, amountMinor: 1100000, purpose: "Дополнительный расход" });
  await assert.rejects(budget(ids.head, "mark_sent", { id: over.id, date }), /недостаточно/);

  const expenseId = randomUUID();
  const path = ids.coord + "/" + expenseId + "/" + randomUUID() + ".pdf";
  const receipt = { id: expenseId, advanceId: sent.id, date, amountMinor: 1000000,
    description: "Печать материалов", receiptPath: path, receiptName: "Чек.pdf" };
  await assert.rejects(budget(ids.coord, "submit", receipt), /Прикрепите чек/);
  await as(ids.coord, () => db.query("insert into storage.objects(bucket_id,name) values('budget-receipts',$1)", [path]));
  let expense = await budget(ids.coord, "submit", receipt);
  assert.equal(expense.status, "pending");
  assert.equal(await as(ids.other, () => scalar("select count(*)::int from storage.objects where bucket_id='budget-receipts'")), 0);
  assert.equal(await as(ids.head, () => scalar("select count(*)::int from storage.objects where bucket_id='budget-receipts'")), 1);
  await assert.rejects(budget(ids.other, "review", { id: expenseId, version: 1, status: "accepted" }), /руководство|руководитель/);
  expense = await budget(ids.head, "review", { id: expenseId, version: 1, status: "returned", note: "Уточните назначение" });
  assert.equal(expense.status, "returned");
  expense = await budget(ids.coord, "submit", { ...receipt, version: expense.version, description: "Печать материалов для встречи" });
  expense = await budget(ids.head, "review", { id: expenseId, version: expense.version, status: "accepted" });
  assert.equal(expense.status, "accepted");
  await assert.rejects(budget(ids.coord, "submit", { ...receipt, version: expense.version }), /изменился/);
});

test("leadership titles normalize to head access; legacy role codes cannot be assigned", async () => {
  const dev = randomUUID(), deputy = randomUUID();
  for (const [id, title] of [[dev, "developer"], [deputy, "deputy"]]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query("insert into profiles(id,data) values($1,$2)", [id, { id, name: "Доступ " + title, role: "staff", title, active: true }]);
    assert.equal(await as(id, () => scalar("select my_role()")), "head");
  }
  await as(dev, () => db.query("update profiles set data=data||'{\"role\":\"staff\",\"title\":\"staff\"}' where id=$1", [ids.recipient]));
  assert.equal(await scalar("select data->>'role' from profiles where id=$1", [ids.recipient]), "staff");
  await db.query("update profiles set data=data||'{\"role\":\"coordinator\",\"title\":\"coordinator\"}' where id=$1", [ids.recipient]);
  await assert.rejects(as(ids.coord, () => db.query("update profiles set data=data||'{\"title\":\"developer\"}' where id=$1", [ids.coord])), /Роль/);
  await assert.rejects(db.query("update profiles set data=data||'{\"role\":\"member\",\"title\":\"party_member\"}' where id=$1", [dev]), /действующую роль/);
});

test("TickTick tokens, state and job claim are inaccessible to app users", async () => {
  await assert.rejects(as(ids.head, () => scalar("select token_ciphertext from ticktick_connections")), /permission denied/);
  await assert.rejects(as(ids.coord, () => scalar("select ticktick_claim_sync()")), /permission denied/);
  await db.query("insert into ticktick_oauth_states(user_id,state_hash,expires_at,claimed) values($1,'one',now()+interval '1 minute',true)", [ids.coord]);
  assert.equal(await scalar("select ticktick_finish_link('one','test-encrypted')"), true);
  assert.equal(await scalar("select ticktick_finish_link('one','replayed')"), false);
  await db.query("update ticktick_connections set projects=array['work'] where user_id=$1", [ids.coord]);
  assert.equal(await scalar("select count(*)::int from ticktick_claim_sync()", []), 1);
  assert.equal(await scalar("select count(*)::int from ticktick_claim_sync()", []), 0);
  assert.equal(await scalar("select ticktick_disconnect($1)", [ids.coord]), "test-encrypted");
  assert.equal(await scalar("select count(*)::int from ticktick_connections"), 0);
});
