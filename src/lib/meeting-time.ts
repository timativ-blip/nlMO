import type { Meeting } from '../data/communication-types';
import { TZ } from './date';

const dateTime = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const inputTime = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const meetingWhen = (iso: string) => `${dateTime.format(new Date(iso))} МСК`;
export const meetingInput = (iso: string) => inputTime.format(new Date(iso)).replace(' ', 'T');
export function meetingInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Выберите дату и время встречи.');
  const parsed = new Date(value + ':00+03:00');
  if (!Number.isFinite(+parsed) || meetingInput(parsed.toISOString()) !== value) throw new Error('Проверьте дату и время встречи.');
  return parsed.toISOString();
}
export function meetingPhase(meeting: Meeting, now = Date.now()): Meeting['phase'] {
  if (meeting.endedAt && meeting.scheduledAt && Date.parse(meeting.endedAt) < Date.parse(meeting.scheduledAt)) return 'cancelled';
  if (meeting.endedAt || Date.parse(meeting.expiresAt) <= now) return 'ended';
  return meeting.scheduledAt && Date.parse(meeting.scheduledAt) > now ? 'scheduled' : 'live';
}
export function meetingLabel(meeting: Meeting, now = Date.now()) {
  const phase = meetingPhase(meeting, now);
  return phase === 'cancelled' ? 'Отменена' : phase === 'ended' ? 'Завершена' : phase === 'scheduled' ? 'Запланирована' : meeting.locked ? 'Вход закрыт' : 'Идёт';
}
