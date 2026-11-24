import type { PdData } from './media-types';
import { SEASON_11 } from './media-season';
import { addDays, fmtDate, plural } from '../lib/date';
import { surnameFirst } from '../lib/names';

export interface ReportAuthor { index: number; name: string; group: string; registered: boolean; posts: number; counted: number }
export interface ReportRow { id: string; label: string; contact: string; registered: number; ranked: number; writing: number; posts: number; counted: number; writingDelta: number; postsDelta: number; authors: ReportAuthor[]; declared?: number }
export interface MediaReport { from: string; to: string; compareTo: string; updated: string; rows: ReportRow[]; districts: ReportRow; total: ReportRow; outside: ReportRow; all: ReportRow; stale: boolean }

export const reportDate = (date: string) => date < SEASON_11.from ? SEASON_11.from : date > SEASON_11.to ? SEASON_11.to : date;
export const reportWeekBefore = (date: string) => addDays(date, -7);

/** Both snapshots use current source criteria and membership, with publication-date cutoffs.
 * This is a recomputation, not an archived copy of what the spreadsheet contained a week ago. */
export function buildMediaReport(data: PdData, to: string, compareTo = reportWeekBefore(to)): MediaReport {
  const validDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!validDay(to) || !validDay(compareTo)) throw new Error('Укажите корректные даты отчёта.');
  to = reportDate(to);
  if (compareTo >= to) throw new Error('Дата сравнения должна быть раньше даты отчёта.');
  const members = new Set(data.roster?.members ?? data.people.flatMap(([, group], i) => group === 'none' ? [] : [i]));
  const authors: ReportAuthor[] = data.people.map(([name, group], index) => ({ name:surnameFirst(name), group, index, registered: members.has(index), posts: 0, counted: 0 }));
  const previous = data.people.map(() => ({ posts: 0, counted: 0 }));
  for (const p of data.posts) {
    if (p[0] < SEASON_11.from || p[0] > to || p[0] > SEASON_11.to || !authors[p[4]]) continue;
    authors[p[4]].posts++;
    if (p[13] !== 0) authors[p[4]].counted++;
    if (p[0] <= compareTo) { previous[p[4]].posts++; if (p[13] !== 0) previous[p[4]].counted++; }
  }
  const row = (id: string, label: string, people: ReportAuthor[], contact = '', declared?: number): ReportRow => {
    const writing = people.filter(a => a.posts > 0).length, posts = people.reduce((s, a) => s + a.posts, 0);
    return { id, label, contact, authors: people, declared, registered: people.filter(a => a.registered).length,
      ranked: people.filter(a => a.counted > 0).length, writing, posts, counted: people.reduce((s, a) => s + a.counted, 0),
      writingDelta: writing - people.filter(a => previous[a.index].posts > 0).length,
      postsDelta: posts - people.reduce((s, a) => s + previous[a.index].posts, 0) };
  };
  const rows = data.groups.filter(g => g.num > 0 || g.id === 'hq').sort((a, b) => (a.num || 1000) - (b.num || 1000))
    .map(g => row(g.id, g.num ? `${g.num} округ` : 'Штаб', authors.filter(a => a.group === g.id), data.roster?.contacts[g.id], data.roster?.declared[g.id]));
  const known = new Set(rows.map(g => g.id));
  const districts = row('districts', 'Все округа', authors.filter(a => rows.some(g => g.id === a.group && g.id !== 'hq')));
  const total = row('total', 'Округа и штаб', authors.filter(a => known.has(a.group)));
  const outside = row('none', 'Без подтверждённого округа', authors.filter(a => !known.has(a.group) && a.posts > 0));
  const all = row('all', 'Вся выгрузка', authors);
  return { from: SEASON_11.from, to, compareTo, rows, districts, total, outside, all, updated: data.updated, stale: data.sourceStatus === 'stale' };
}

export const postCount = (n: number) => `${n} ${plural(n, ['пост', 'поста', 'постов'])}`;
export const authorCount = (n: number) => `${n} ${plural(n, ['автор', 'автора', 'авторов'])}`;
export const reportDelta = (n: number) => n ? ` (${n > 0 ? '+' : ''}${n})` : '';
export function mediaReportText(r: MediaReport) {
  const lines = [`ПИШИ-ДЕЛИСЬ · 11 СЕЗОН`, `${fmtDate(r.from)} — ${fmtDate(r.to)}`, `Изменения к ${fmtDate(r.compareTo)} (по датам публикаций).`, '', 'Округ | Зарегистрировано | В рейтинге | Пишет | Постов (зачтено)'];
  for (const g of [...r.rows.filter(g => g.id !== 'hq'), r.districts, ...r.rows.filter(g => g.id === 'hq'), r.total, r.outside, r.all]) {
    lines.push(`${g.label} | ${g.registered} | ${g.ranked} | ${g.writing}${reportDelta(g.writingDelta)} | ${g.posts}${reportDelta(g.postsDelta)} (${g.counted} зачтено)`);
  }
  lines.push('', 'В рейтинге — хотя бы один зачтённый пост. Пишет — хотя бы одна публикация любого статуса, включая авторов вне рейтинга. Каждый человек считается один раз.', 'Состав и статусы взяты из текущей таблицы; исторические изменения списка и зачёта не восстанавливаются.', '');
  for (const g of [...r.rows, r.outside]) {
    lines.push(`${g.label}${g.contact ? ' · ' + g.contact : ''}`);
    for (const a of g.authors) lines.push(`${a.posts ? '🟢' : '🔴'} ${a.name} — ${postCount(a.posts)}, ${a.counted} зачтено${!a.registered ? ' · вне списка «Авторы»' : ''}`);
    lines.push(`Пишет: ${g.writing} из ${g.registered}. В рейтинге: ${g.ranked}. Постов: ${g.posts}, зачтено: ${g.counted}.`, '');
  }
  if (r.stale) lines.unshift('ВНИМАНИЕ: источник не обновился, отчёт по последним полученным данным.');
  return lines.join('\n');
}

export function mediaReportCsv(r: MediaReport) {
  const rows: (string | number)[][] = [
    ['Пиши-Делись · 11 сезон', fmtDate(r.from), fmtDate(r.to)], ['Сравнение по дате публикации', fmtDate(r.compareTo)],
    ['Округ', 'Зарегистрировано авторов', 'В рейтинге', 'Сколько пишет', 'Изменение пишущих', 'Количество постов', 'Изменение постов', 'Зачтено'],
    ...[...r.rows.filter(g => g.id !== 'hq'), r.districts, ...r.rows.filter(g => g.id === 'hq'), r.total, r.outside, r.all].map(g => [g.label, g.registered, g.ranked, g.writing, g.writingDelta, g.posts, g.postsDelta, g.counted]),
    [], ['Округ', 'ФИО', 'В списке «Авторы»', 'Постов', 'Зачтено'],
    ...[...r.rows, r.outside].flatMap(g => g.authors.map(a => [g.label, a.name, a.registered ? 'Да' : 'Нет', a.posts, a.counted])),
  ];
  // CSV opened in a spreadsheet must not execute names/labels as formulas.
  return '\uFEFF' + rows.map(row => row.map(v => `"${String(typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""')}"`).join(';')).join('\r\n');
}

export function mediaReportSvg(r: MediaReport) {
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
  const rows = r.rows.filter(g => g.id !== 'hq'), height = 270 + (rows.length + 1) * 58 + 162;
  const centers = [175, 430, 745, 1080, 1410], widths = [190, 320, 310, 360, 300], starts = [80, 270, 590, 900, 1260];
  const text = (x: number, y: number, value: string, extra = '') => `<text x="${x}" y="${y}" text-anchor="middle" ${extra}>${escape(value)}</text>`;
  const content = rows.map((g, i) => {
    const y = 270 + i * 58;
    return `<rect x="80" y="${y}" width="1480" height="58" fill="#103f43"/><rect x="900" y="${y}" width="360" height="58" fill="#70dfd6"/>` +
      [g.id, String(g.registered), String(g.ranked), `${g.writing}${reportDelta(g.writingDelta)}`, `${g.posts}${reportDelta(g.postsDelta)}`].map((v, k) => text(centers[k], y + 36, v, `fill="${k === 3 ? '#08333a' : '#f0fffd'}"`)).join('') + `<path d="M80 ${y + 58}H1560" stroke="#467576" stroke-opacity=".7"/>`;
  }).join('');
  const bottom = 270 + rows.length * 58;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1640" height="${height}" viewBox="0 0 1640 ${height}"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#020f16"/><stop offset=".55" stop-color="#063e43"/><stop offset="1" stop-color="#139c98"/></linearGradient></defs><rect width="1640" height="${height}" fill="url(#bg)"/><g font-family="Arial, sans-serif" font-size="21" fill="#f0fffd"><text x="80" y="100" font-size="45" font-weight="700">ПИШИ-ДЕЛИСЬ <tspan fill="#70dfd6">11 СЕЗОН</tspan></text><text x="80" y="149" font-size="22">${fmtDate(r.from)} — ${fmtDate(r.to)} · изменения к ${fmtDate(r.compareTo)}</text><text x="1560" y="82" text-anchor="end" font-weight="700" font-size="24">НОВЫЕ ЛЮДИ</text><text x="1560" y="114" text-anchor="end" font-size="17">МОСКОВСКАЯ ОБЛАСТЬ</text>${starts.map((x, k) => `<rect x="${x}" y="202" width="${widths[k]}" height="68" fill="${k === 3 ? '#70dfd6' : '#155353'}"/>`).join('')}${['Округ', 'Зарегистрировано авторов', 'В рейтинге', 'Сколько пишет', 'Количество постов'].map((v, k) => text(centers[k], 244, v, `font-size="19" font-weight="700" fill="${k === 3 ? '#08333a' : '#81e4dc'}"`)).join('')}${content}<rect x="80" y="${bottom}" width="1480" height="58" fill="#0a2c36"/>${['Все округа', String(r.districts.registered), String(r.districts.ranked), `${r.districts.writing}${reportDelta(r.districts.writingDelta)}`, `${r.districts.posts}${reportDelta(r.districts.postsDelta)}`].map((v, k) => text(centers[k], bottom + 36, v, 'font-weight="700"')).join('')}<text x="80" y="${bottom + 98}" font-size="19">Штаб: ${r.rows.find(g => g.id === 'hq')?.writing ?? 0} пишут · ${r.rows.find(g => g.id === 'hq')?.posts ?? 0} постов. Без округа: ${authorCount(r.outside.writing)} · ${postCount(r.outside.posts)}.</text><text x="80" y="${bottom + 132}" font-size="19">Вся выгрузка: ${authorCount(r.all.writing)} · ${postCount(r.all.posts)} · ${r.all.counted} зачтено.</text><text x="80" y="${bottom + 166}" font-size="16" fill="#b6e9e7">Пишет — любой пост, включая авторов вне рейтинга. В рейтинге — есть зачтённый пост. Данные — из текущей таблицы.</text>${r.stale ? `<text x="80" y="${bottom + 197}" fill="#ffd797" font-size="17">Источник не обновился: показаны последние полученные данные.</text>` : ''}</g></svg>`;
}
