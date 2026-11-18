import test from "node:test";
import assert from "node:assert/strict";
import { pdReminderCandidates } from "../.test-media/media-entry.js";

const today = "2026-11-18";
const now = Date.parse(today + "T09:00:00Z");
const snapshot = {
  sourceStatus: "ok", updated: new Date(now).toISOString(),
  people: [["Васильев Пётр", "121"], ["Сидоров Андрей", "122"], ["Иванов Алексей", "123"]],
  posts: [["2026-11-15", "", "", "vk", 0], ["2026-09-30", "", "", "vk", 2]],
  roster: { members: [0, 1] },
};
const profiles = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Петр Васильев", role: "head", active: true },
  { id: "bbbbbbbb-0000-0000-0000-000000000002", name: "Сидоров Андрей", role: "coordinator", districtId: "122" },
  { id: "cccccccc-0000-0000-0000-000000000003", name: "Иванов Алексей", role: "staff" },
];

test("a fresh import with a three-day publication gap still reminds current season authors", () => {
  const { items } = pdReminderCandidates(snapshot, profiles, today, now);
  assert.deepEqual(items.map((item) => item.userId), [profiles[0].id, profiles[1].id]);
  assert.equal(items[0].link, "#/media/brief");
  const sameSlot = pdReminderCandidates(snapshot, profiles, "2026-11-19", now).items;
  assert.equal(items[0].id, sameSlot[0].id);
});

test("source outages, recent posts, name ambiguity and off-season dates avoid false alerts", () => {
  assert.equal(pdReminderCandidates({ ...snapshot, sourceStatus: "stale" }, profiles, today, now).items.length, 0);
  assert.equal(pdReminderCandidates(snapshot, profiles, today, now + 2 * 86400000).items.length, 0);
  assert.equal(pdReminderCandidates(snapshot, profiles, "2026-12-21", now).items.length, 0);
  const active = { ...snapshot, posts: [[today, "", "", "vk", 0]] };
  assert.deepEqual(pdReminderCandidates(active, profiles, today, now).items.map((item) => item.userId), [profiles[1].id]);
  const ambiguous = { ...snapshot, people: [...snapshot.people, ["Пётр Васильев", "122"]], roster: { members: [0, 1, 3] } };
  assert.deepEqual(pdReminderCandidates(ambiguous, profiles, today, now).items.map((item) => item.userId), [profiles[1].id]);
});
