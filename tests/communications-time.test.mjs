import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingInput, meetingInstant, meetingPhase, meetingWhen } from '../.test-communications/communications-entry.js';

test('a Moscow meeting time has the same UTC instant on devices in other timezones', () => {
  assert.equal(meetingInstant('2026-12-31T23:30'), '2026-12-31T20:30:00.000Z');
  assert.equal(meetingInput('2027-01-01T00:30:00.000Z'), '2027-01-01T03:30');
  assert.match(meetingWhen('2026-12-31T20:30:00.000Z'), /23:30 МСК/);
  for (const date of ['', '2026-02-30T12:00', '2026-11-02T25:00']) assert.throws(() => meetingInstant(date), /дат|врем/);
});
test('scheduled admission opens at the precise start and closes at expiry, with distinct cancellation', () => {
  const meeting = { scheduledAt: '2026-11-03T10:00:00Z', expiresAt: '2026-11-03T18:00:00Z', endedAt: null };
  assert.equal(meetingPhase(meeting, Date.parse('2026-11-03T09:59:59Z')), 'scheduled');
  assert.equal(meetingPhase(meeting, Date.parse('2026-11-03T10:00:00Z')), 'live');
  assert.equal(meetingPhase(meeting, Date.parse('2026-11-03T18:00:00Z')), 'ended');
  assert.equal(meetingPhase({ ...meeting, endedAt: '2026-11-03T09:00:00Z' }), 'cancelled');
});
