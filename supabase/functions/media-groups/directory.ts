import { DISTRICT_SHEET_URL, type DistrictDirectory, type DirectoryDistrict } from '../_shared/district-directory.ts';
import { parseCsv } from '../_shared/media-timeline.ts';

export function parseDistrictDirectory(csv: string): DirectoryDistrict[] {
  const [head = [], ...rows] = parseCsv(csv.replace(/^\uFEFF/, ''));
  const normalize = (value: string) => value.toLowerCase().replace(/\s/g, '');
  const column = (prefix: string) => head.findIndex(value => normalize(value).startsWith(prefix));
  const districtColumn = column('№округа'), cityColumn = column('город'), coordinatorColumn = column('координатор');
  if ([districtColumn, cityColumn, coordinatorColumn].some(index => index < 0)) throw new Error('Нет колонок справочника округов.');
  const districts = new Map<string, Map<string, string>>();
  let district = '';
  for (const row of rows) {
    const cell = (index: number) => (row[index] ?? '').trim();
    if (cell(districtColumn)) district = cell(districtColumn);
    if (!/^(11[89]|12[0-9])$/.test(district) || !cell(cityColumn)) continue;
    const names = districts.get(district) ?? new Map<string, string>();
    const name = cell(coordinatorColumn).replace(/\s+/g, ' ');
    if (name) names.set(name.toLowerCase().replace(/ё/g, 'е'), name);
    districts.set(district, names);
  }
  if (!districts.size) throw new Error('В справочнике нет округов.');
  return [...districts].map(([id, names]) => ({ id, coordinatorName: names.size === 1 ? [...names.values()][0] : null, conflict: names.size > 1 }));
}


const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json' };
export function createDistrictDirectoryHandler(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let cache: { at: number; data: DistrictDirectory } | null = null;
  let pending: Promise<void> | null = null;
  const refresh = () => {
    if (!pending) pending = (async () => {
      const response = await fetcher(DISTRICT_SHEET_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Справочник недоступен.');
      const districts = parseDistrictDirectory(await response.text());
      const at = now(); cache = { at, data: { districts, updated: new Date(at).toISOString(), sourceStatus: 'ok' } };
    })().finally(() => { pending = null; });
    return pending;
  };
  return async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers });
    if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers });
    try {
      if (!cache || now() - cache.at >= 60000) await refresh();
      return new Response(JSON.stringify(cache!.data), { headers: { ...headers, 'Cache-Control': 'public, max-age=0' } });
    } catch {
      return cache && now() - cache.at <= 900000
        ? new Response(JSON.stringify({ ...cache.data, sourceStatus: 'stale' }), { headers: { ...headers, 'Cache-Control': 'no-store' } })
        : new Response(JSON.stringify({ error: 'Не удалось обновить справочник округов.' }), { status: 502, headers: { ...headers, 'Cache-Control': 'no-store' } });
    }
  };
}
