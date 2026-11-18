import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizationUrl, exchangeCode, importTasks, openToken, openTokenKey, sealToken, selectedProjects,
} from "../.test-headquarters/headquarters-entry.js";

const callback = "https://example.invalid/ticktick/callback";
test("TickTick connection requests read access and encrypts the token for its owner", async () => {
  const url = new URL(authorizationUrl("client", callback, "state"));
  assert.equal(url.origin, "https://ticktick.com");
  assert.equal(url.searchParams.get("scope"), "tasks:read");
  assert.equal(url.searchParams.get("redirect_uri"), callback);
  const token = await exchangeCode("client", "secret", callback, "code", async (endpoint, options) => {
    assert.equal(endpoint, "https://ticktick.com/oauth/token");
    assert.equal(options.body.get("grant_type"), "authorization_code");
    assert.equal(options.body.get("scope"), "tasks:read");
    return Response.json({ access_token: "private token" });
  });
  const key = await openTokenKey("aa".repeat(32));
  const encrypted = await sealToken(key, token, "owner");
  assert.ok(!encrypted.includes(token));
  assert.equal(await openToken(key, encrypted, "owner"), token);
  await assert.rejects(openToken(key, encrypted, "other"));
});

test("sync filters provider responses to selected projects and handles reopened and completed tasks", async () => {
  const paths = [];
  const item = (id, projectId, dueDate) => ({ id, projectId, dueDate, title: "Task " + id, priority: 3 });
  const tasks = await importTasks("mock", ["chosen"], new Date("2026-11-18T09:00:00Z"), async (url, options) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path === "/open/v1/project") return Response.json([{ id: "chosen", name: "Работа" }, { id: "elsewhere", name: "Личное" }]);
    if (path === "/open/v1/project/chosen/data") {
      return Response.json({ tasks: [item("a", "chosen", "2026-11-20T00:00:00+0300"), item("private", "elsewhere")] });
    }
    if (path === "/open/v1/task/completed") {
      assert.deepEqual(JSON.parse(options.body).projectIds, ["chosen"]);
      return Response.json([item("a", "chosen"), item("done", "chosen"), item("secret", "elsewhere")]);
    }
    throw new Error("Unexpected path " + path);
  });
  assert.equal(paths.length, 3);
  assert.deepEqual(tasks.map(({ id, status, dueDay }) => [id, status, dueDay]),
    [["chosen/a", "active", "2026-11-20"], ["chosen/done", "completed", null]]);
  assert.throws(() => selectedProjects(["elsewhere"], [{ id: "chosen", name: "Работа" }]), /списков/);
});
