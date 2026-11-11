import test from "node:test";
import assert from "node:assert/strict";
import {
  coordinatorPerformance,
  createMeetingAiHandler,
  validateMinutes,
} from "../.test-headquarters/headquarters-entry.js";
const content = {
  agenda: "Обсудили работу",
  summary: "Согласовали план",
  decisions: "Подготовить материал",
  actions: "Ответственный не указан; срок не указан",
};
const person = {
    id: "coord",
    role: "coordinator",
    districtId: "121",
    active: true,
  },
  head = { id: "head", role: "head" };
const task = (id, extra = {}) => ({
  id,
  districtId: "121",
  due: "2026-11-09",
  status: "new",
  assigneeId: "coord",
  coAssigneeIds: [],
  authorId: "head",
  ...extra,
});
const state = (tasks = []) => ({
  tasks,
  dailyReports: [{ userId: "coord", day: "2026-11-09" }],
});
test("performance excludes future and cancelled tasks, distinguishes no data, and only counts finished weekdays", () => {
  let r = coordinatorPerformance(
    state(),
    head,
    person,
    "2026-11-09",
    "2026-11-15",
    "2026-11-11",
  );
  assert.equal(r.score, null);
  assert.equal(r.timeliness, null);
  assert.deepEqual(r.days, ["2026-11-09", "2026-11-10"]);
  assert.equal(r.reported.length, 1);
  r = coordinatorPerformance(
    state([
      task("1", { status: "done", result: { submittedDate: "2026-11-09" } }),
      task("2", { status: "review", result: { submittedDate: "2026-11-10" } }),
      task("3"),
      task("4", { due: "2026-11-12" }),
      task("5", { status: "cancelled" }),
    ]),
    head,
    person,
    "2026-11-09",
    "2026-11-15",
    "2026-11-11",
  );
  assert.equal(r.tasks.length, 3);
  assert.equal(r.done.length, 1);
  assert.equal(r.submitted.length, 2);
  assert.equal(r.timeliness, 0.5);
  assert.equal(r.score, 40);
});
test("staff cannot mistake hidden daily reports for non-reporting; coordinators cannot inspect another district task cohort", () => {
  const s = state([task("1")]);
  assert.equal(
    coordinatorPerformance(
      s,
      { id: "staff", role: "staff" },
      person,
      "2026-11-01",
      "2026-11-10",
      "2026-11-11",
    ).dailyVisible,
    false,
  );
  assert.equal(
    coordinatorPerformance(
      s,
      { id: "other", role: "coordinator", districtId: "122" },
      person,
      "2026-11-01",
      "2026-11-10",
      "2026-11-11",
    ).tasks.length,
    0,
  );
});
function fixture(configured = false) {
  const calls = [],
    writes = [];
  const handler = createMeetingAiHandler({
    origin: "https://timativ-blip.github.io",
    apiKey: configured ? "test-key" : undefined,
    model: configured ? "configured-test-model" : undefined,
    admin: {
      auth: {
        getUser: async (token) => ({
          data: { user: token === "valid" ? { id: "user" } : null },
          error: null,
        }),
      },
      rpc: async (fn, body) => {
        writes.push({ fn, body });
        return { data: null, error: null };
      },
    },
    userClient: () => ({
      rpc: async (fn, body) => {
        calls.push({ fn, body });
        return {
          data: body.p_action === "ai_begin" ? { claimed: true } : { ok: true },
          error: null,
        };
      },
      auth: {},
    }),
    fetcher: async (_url, init) => {
      calls.push({ model: JSON.parse(init.body) });
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(content) },
          },
        ],
      });
    },
  });
  return { handler, calls, writes };
}
const request = (
  body = {},
  token = "valid",
  origin = "https://timativ-blip.github.io",
) =>
  new Request("https://example.invalid/meeting-ai", {
    method: "POST",
    headers: { authorization: "Bearer " + token, origin },
    body: JSON.stringify({
      archiveId: "00000000-0000-0000-0000-000000000001",
      ...body,
    }),
  });
test("AI preparation is honest while unconfigured and requires verified identity and allowed origin", async () => {
  const f = fixture();
  assert.equal(
    (await f.handler(request({ action: "status" }, "bad"))).status,
    401,
  );
  assert.equal(
    (
      await f.handler(
        request({ action: "status" }, "valid", "https://other.test"),
      )
    ).status,
    403,
  );
  assert.equal(
    (await (await f.handler(request({ action: "status" }))).json()).ready,
    false,
  );
  assert.equal((await f.handler(request({ action: "generate" }))).status, 503);
  assert.equal(f.writes.length, 0);
});
test("AI returns a reviewed preview, never publishes protocol or invents credentials in responses", async () => {
  const f = fixture(true),
    r = await f.handler(
      request({
        action: "generate",
        requestId: "00000000-0000-0000-0000-000000000002",
        transcript:
          "Обсудили план работы. Подготовить материал, ответственного и срок не назвали.",
      }),
    );
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).content, content);
  assert.deepEqual(
    f.writes.map((x) => x.fn),
    ["headquarters_ai_complete"],
  );
  const model = f.calls.find((x) => x.model).model;
  assert.equal(model.store, false);
  assert.match(model.messages[0].content, /Не выдумывай/);
  assert.equal(model.response_format.json_schema.strict, true);
});
test("invalid, partial or excessively long AI output cannot enter a protocol", () => {
  assert.throws(() => validateMinutes({ agenda: "x" }), /неполный/);
  assert.throws(
    () => validateMinutes({ ...content, summary: "x".repeat(8001) }),
    /длинный/,
  );
  assert.throws(() => validateMinutes(null), /некорректный/);
  assert.deepEqual(validateMinutes({ ...content, unsafe: "ignored" }), content);
});
