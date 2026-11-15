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
  workbookUrl?: string;
  sourceStatus?: 'ok' | 'stale';
  roster?: { source: 'authors'; members: number[]; declared: Record<string, number>; contacts: Record<string, string> };
}

export function isPdTimeline(value: unknown): value is PdData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<PdData>;
  return Array.isArray(data.people) && Array.isArray(data.posts) && Array.isArray(data.groups) && data.seasons?.['2026-10'] === 11;
}

export const MEDIA_SEASONS: Record<string, number> = { '2026-09': 10, '2026-10': 11 };
export const SEASON_11 = { number: 11, from: '2026-10-01', to: '2026-12-20' } as const;
const sheetUrl = (name: string) => 'https://docs.google.com/spreadsheets/d/18UL3TQHRS-3A8xkQ1zLwwLcPKCgnGJOQ/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(name);
export const SEASON_11_URL = sheetUrl('11 сезон');
export const ARCHIVE_URL = sheetUrl('10 сезон');
export const AUTHORS_URL = sheetUrl('Авторы');
const districtNames: Record<string, string> = { 118: 'Балашихинский', 119: 'Дмитровский', 120: 'Коломенский', 121: 'Красногорский', 122: 'Люберецкий', 123: 'Мытищинский', 124: 'Одинцовский', 125: 'Орехово-Зуевский', 126: 'Подольский', 127: 'Сергиево-Посадский', 128: 'Серпуховский', 129: 'Щёлковский' };
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

/** A: district/contact, B: declared size, D: current membership. Notes never add people. */
export function buildAuthorRoster(text: string): PdData {
  const groups: PdData['groups'] = [], people: PdData['people'] = [];
  const roster: NonNullable<PdData['roster']> = { source: 'authors', members: [], declared: {}, contacts: {} };
  let group = '';
  const seen = new Set<string>();
  for (const row of parseCsv(text.replace(/^\uFEFF/, ''))) {
    const heading = (row[0] ?? '').trim();
    const district = heading.match(/^(11[89]|12\d)\s*округ/i);
    if (district || /^штаб(?:\s|$)/i.test(heading)) {
      group = district?.[1] ?? 'hq';
      if (groups.some(g => g.id === group)) throw new Error('Повторный блок округа в листе «Авторы».');
      groups.push({ id: group, num: district ? Number(group) : 0, name: districtNames[group] ?? 'Штаб' });
      const declared = Number((row[1] ?? '').replace(',', '.'));
      if ((row[1] ?? '').trim() && Number.isInteger(declared) && declared >= 0) roster.declared[group] = declared;
      const contact = heading.match(/@[a-zA-Z0-9_]+/);
      if (contact) roster.contacts[group] = contact[0];
    } else if (heading) group = '';
    const name = (row[3] ?? '').replace(/\s+/g, ' ').trim();
    if (!group || !/^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z .’'-]+$/.test(name) || name.split(' ').length < 2) continue;
    const key = group + ':' + normal(name);
    if (seen.has(key)) continue;
    seen.add(key);
    roster.members.push(people.push([name, group]) - 1);
  }
  if (!groups.length || !people.length) throw new Error('Не удалось прочитать состав из листа «Авторы».');
  return { groups, people, posts: [], roster, updated: new Date().toISOString() };
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
    if (index < 0) {
      const exact = people.map((person, i) => ({ key: normal(person[0]), i }))
        .filter(p => p.key === key || p.key.split(' ').slice(0, 2).reverse().join(' ') === key);
      if (exact.length === 1) index = exact[0].i;
    }
    if (index < 0) {
      const words = key.split(' ');
      const candidates = people.map((person, i) => ({ words: normal(person[0]).split(' '), i }))
        .filter((person) => words.length === 2 && words[1].length === 1 && (
          person.words[0] === words[0] && person.words[1]?.[0] === words[1]
          || person.words[1] === words[0] && person.words[0]?.[0] === words[1]
        ));
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
  return { groups: archive.groups.map((group) => ({ ...group })), people, posts, roster: archive.roster, updated: new Date().toISOString() };
}

export function buildTimeline(archive: PdData, season: PdData): PdData {
  const current = season.posts.filter(p => p[0] >= SEASON_11.from && p[0] <= SEASON_11.to);
  return {
    groups: season.groups, people: season.people, roster: season.roster,
    posts: archive.posts.filter((p) => p[0] < SEASON_11.from).concat(current),
    seasons: { ...archive.seasons, ...MEDIA_SEASONS, ...Object.fromEntries(current.map(p => [p[0].slice(0, 7), 11])) }, updated: season.updated,
    sourceStatus: 'ok',
  };
}

