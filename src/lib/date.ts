// Все даты считаются в московском времени. Даты хранятся строками 'YYYY-MM-DD',
// время событий — 'YYYY-MM-DDTHH:mm' (МСК), отметки истории — ISO UTC.
export const TZ = 'Europe/Moscow';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

export const todayISO = () => dayFmt.format(new Date());
export const nowMsk = () => `${todayISO()}T${timeFmt.format(new Date())}`;
export const stamp = () => new Date().toISOString();

const utc = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00Z');
const iso = (x: Date) => x.toISOString().slice(0, 10);

export function addDays(s: string, n: number) {
  const x = utc(s);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
}
export const diffDays = (a: string, b: string) => Math.round((utc(a).getTime() - utc(b).getTime()) / 864e5);
export const weekday = (s: string) => (utc(s).getUTCDay() + 6) % 7; // 0 = пн
export const weekStart = (s: string) => addDays(s, -weekday(s));
export const monthStart = (s: string) => s.slice(0, 8) + '01';
export function monthEnd(s: string) {
  const x = utc(monthStart(s));
  x.setUTCMonth(x.getUTCMonth() + 1);
  x.setUTCDate(0);
  return iso(x);
}
export function addMonths(s: string, n: number) {
  const x = utc(monthStart(s));
  x.setUTCMonth(x.getUTCMonth() + n);
  return iso(x);
}
export const inRange = (s: string | undefined | null, from: string, to: string) => !!s && s.slice(0, 10) >= from && s.slice(0, 10) <= to;

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WD_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export const fmtDate = (s?: string | null) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—');
export const fmtDayMonth = (s: string) => `${+s.slice(8, 10)} ${MONTHS_SHORT[+s.slice(5, 7) - 1]}`;
export const fmtDayLong = (s: string) => `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]}, ${WD_LONG[weekday(s)]}`;
export const fmtTime = (s?: string) => (s && s.length > 10 ? s.slice(11, 16) : '');
export const fmtMonth = (s: string) => `${MONTHS_NOM[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
export const fmtRange = (a: string, b: string) => (a === b ? fmtDayMonth(a) : `${fmtDayMonth(a)} — ${fmtDayMonth(b)}`);

export function fmtStamp(isoStr: string) {
  const d = new Date(isoStr);
  return `${fmtDate(dayFmt.format(d))}, ${timeFmt.format(d)}`;
}
export function fmtAgo(isoStr: string) {
  const min = Math.round((Date.now() - new Date(isoStr).getTime()) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${plural(h, ['час', 'часа', 'часов'])} назад`;
  return fmtStamp(isoStr);
}

export function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function relDue(due: string, today = todayISO()) {
  const d = diffDays(due, today);
  if (d === 0) return 'сегодня';
  if (d === 1) return 'завтра';
  if (d === -1) return 'вчера';
  if (d > 1 && d < 7) return `через ${d} ${plural(d, ['день', 'дня', 'дней'])}`;
  return fmtDayMonth(due);
}

export type PeriodKey = 'week' | 'prevweek' | 'month' | 'prevmonth' | 'quarter';
export interface Period { key: PeriodKey; from: string; to: string; label: string; prevFrom: string; prevTo: string }
export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'week', label: 'Эта неделя' },
  { value: 'prevweek', label: 'Прошлая неделя' },
  { value: 'month', label: 'Этот месяц' },
  { value: 'prevmonth', label: 'Прошлый месяц' },
  { value: 'quarter', label: 'Последние 90 дней' },
];

export function getPeriod(key: PeriodKey, today = todayISO()): Period {
  const label = PERIOD_OPTIONS.find((p) => p.value === key)!.label;
  if (key === 'week' || key === 'prevweek') {
    const from = addDays(weekStart(today), key === 'week' ? 0 : -7);
    return { key, label, from, to: addDays(from, 6), prevFrom: addDays(from, -7), prevTo: addDays(from, -1) };
  }
  if (key === 'month' || key === 'prevmonth') {
    const from = key === 'month' ? monthStart(today) : addMonths(today, -1);
    const pf = addMonths(from, -1);
    return { key, label, from, to: monthEnd(from), prevFrom: pf, prevTo: monthEnd(pf) };
  }
  const from = addDays(today, -89);
  return { key, label, from, to: today, prevFrom: addDays(from, -90), prevTo: addDays(from, -1) };
}
