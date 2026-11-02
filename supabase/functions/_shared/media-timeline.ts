// Shared by the website, media endpoint and Telegram digest. No browser-only dependencies.
export type Src = 'vk' | 'tg' | 'youtube' | 'tiktok' | 'instagram' | 'other';
// [дата, заголовок, канал, источник, автор, баллы, вклад, просмотры, лайки, комм., репосты, избранное, url, засчитан, причина]
export type Post = [string, string, string, Src, number, number, number, number, number, number, number, number, string, 0 | 1, string];
export interface PdData {
  groups: { id: string; num: number; name: string }[];
  people: [string, string][];
  posts: Post[];
  seasons?: Record<string, number>;
  updated: string;
  sourceStatus?: 'ok' | 'stale';
}

export function isPdTimeline(value: unknown): value is PdData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<PdData>;
  return Array.isArray(data.people) && Array.isArray(data.posts) && Array.isArray(data.groups) && data.seasons?.['2026-10'] === 11;
}

export const MEDIA_SEASONS: Record<string, number> = { '2026-09': 10, '2026-10': 11 };
export const SEASON_11_URL = 'https://docs.google.com/spreadsheets/d/18UL3TQHRS-3A8xkQ1zLwwLcPKCgnGJOQ/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent('11 сезон');
const sources: Src[] = ['vk', 'tg', 'youtube', 'tiktok', 'instagram'];
const normal = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const number = (value: string) => {
  const n = Number(value.replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function postDate(value: string) {
  const iso = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  const dotted = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:$|\s)/);
  const day = iso?.[1] ?? (dotted ? `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}` : '');
  return day && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day ? day : '';
}

export function buildSeason(text: string, archive: PdData): PdData {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  const headers = rows.shift() ?? [];
  const columns = new Map(headers.map((name, index) => [name.trim(), index]));
  for (const name of ['Дата поста', 'ФИО', 'Источник', 'Очки', 'URL']) {
    if (!columns.has(name)) throw new Error(`В листе «11 сезон» нет колонки «${name}».`);
  }
  const value = (row: string[], name: string) => row[columns.get(name) ?? -1] ?? '';
  const people: [string, string][] = archive.people.map(([name, group]) => [name, group]);
  const byUrl = new Map(archive.posts.filter((p) => p[12]).map((p) => [p[12], p[4]]));
  const aliases = new Map<string, Set<number>>();
  // A known post links abbreviated names to the same author as the old loader.
  for (const row of rows) {
    const index = byUrl.get(value(row, 'URL').trim());
    if (index === undefined || !people[index]) continue;
    const key = normal(value(row, 'ФИО'));
    const matches = aliases.get(key) ?? new Set<number>();
    matches.add(index); aliases.set(key, matches);
  }
  const matched = new Map<string, number>();
  function personIndex(name: string) {
    const key = normal(name);
    const cached = matched.get(key);
    if (cached !== undefined) return cached;
    const alias = aliases.get(key);
    let index = alias?.size === 1 ? [...alias][0] : -1;
    if (index < 0) index = people.findIndex((person) => normal(person[0]) === key);
    if (index < 0) {
      const words = key.split(' ');
      const candidates = people.map((person, i) => ({ words: normal(person[0]).split(' '), i }))
        .filter((person) => person.words[0] === words[0] && words[1] && person.words[1] && person.words[1][0] === words[1][0]);
      if (candidates.length === 1) index = candidates[0].i;
    }
    if (index < 0) index = people.push([name.trim(), 'none']) - 1;
    matched.set(key, index);
    return index;
  }
  const posts: Post[] = [], seen = new Set<string>();
  for (const row of rows) {
    const day = postDate(value(row, 'Дата поста'));
    const name = value(row, 'ФИО').trim();
    if (!day || !name) continue;
    const rawUrl = value(row, 'URL').trim();
    const key = rawUrl || [day, value(row, 'Источник'), value(row, 'ID аккаунта'), value(row, 'Заголовок')].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const source = value(row, 'Источник').trim().toLowerCase() as Src;
    posts.push([
      day, value(row, 'Заголовок'), value(row, 'Канал/группа'), sources.includes(source) ? source : 'other',
      personIndex(name), number(value(row, 'Очки')), number(value(row, 'Вклад в регион')),
      number(value(row, 'Просмотры')), number(value(row, 'Лайки')), number(value(row, 'Комментарии')),
      number(value(row, 'Репосты')), number(value(row, 'В избранное')), /^https?:\/\//i.test(rawUrl) ? rawUrl : '',
      normal(value(row, 'Критерии')) === 'выполнены' ? 1 : 0, value(row, 'Невыполненные критерии'),
    ]);
  }
  return { groups: archive.groups.map((group) => ({ ...group })), people, posts, updated: new Date().toISOString() };
}

export function buildTimeline(archive: PdData, season: PdData): PdData {
  const current = season.posts.filter(p => p[0] >= '2026-10-01');
  const replaced = new Set(['2026-10', ...current.map(p => p[0].slice(0, 7))]);
  return {
    groups: season.groups, people: season.people,
    posts: archive.posts.filter((p) => !replaced.has(p[0].slice(0, 7))).concat(current),
    seasons: { ...archive.seasons, ...MEDIA_SEASONS, ...Object.fromEntries(current.map(p => [p[0].slice(0, 7), 11])) }, updated: season.updated,
    sourceStatus: 'ok',
  };
}

