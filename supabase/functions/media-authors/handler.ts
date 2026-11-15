import { MEDIA_BRIDGE_URL, MEDIA_WORKBOOK_URL, readMediaWorkbook } from '../_shared/media-workbook.ts';
interface Actor { role: string; districtId: string | null; active: boolean; pending?: boolean }
export function validateAuthor(actor: Actor, value: unknown) {
  if (!actor.active || actor.pending || !['head', 'staff', 'coordinator'].includes(actor.role)) throw new Error('Добавлять авторов могут координаторы и штаб.');
  const b = value as { name?: unknown; groupId?: unknown };
  const name = typeof b?.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
  const groupId = typeof b?.groupId === 'string' ? b.groupId : '';
  if (!/^(11[89]|12\d|hq)$/.test(groupId) || actor.role === 'coordinator' && actor.districtId !== groupId) throw new Error('Можно добавлять авторов только в свой округ.');
  if (name.length < 4 || name.length > 120 || !/^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z ’'\-]+$/.test(name) || name.split(' ').length < 2) throw new Error('Укажите фамилию и имя автора.');
  return { name, groupId };
}
export function createMediaAuthorsHandler(deps: { authorize: (token: string) => Promise<Actor | null>; apiKey: string; fetcher?: typeof fetch; bridgeUrl?: string }) {
  const fetcher = deps.fetcher ?? fetch, bridge = deps.bridgeUrl ?? MEDIA_BRIDGE_URL;
  return async (req: Request) => {
    const origin = req.headers.get('origin'), headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
    if (origin === 'https://timativ-blip.github.io') headers['Access-Control-Allow-Origin'] = origin;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && origin !== 'https://timativ-blip.github.io') return json({ error: 'Нет доступа с этого адреса.' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);
    try {
      const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      const actor = token ? await deps.authorize(token) : null;
      if (!actor) return json({ error: 'Войдите на сайт снова.' }, 401);
      if (!actor.active || actor.pending || !['head', 'staff', 'coordinator'].includes(actor.role)) return json({ error: 'Нет доступа к составу округа.' }, 403);
      const raw = await req.text(); if (raw.length > 4000) return json({ error: 'Слишком большой запрос.' }, 413);
      const body = JSON.parse(raw);
      if (body.action === 'status') return json({ ready: !!bridge, workbookUrl: MEDIA_WORKBOOK_URL });
      if (body.action !== 'add') return json({ error: 'Неизвестное действие.' }, 400);
      let input; try { input = validateAuthor(actor, body); } catch (e) { return json({ error: (e as Error).message }, 403); }
      if (!bridge) return json({ error: 'Связь с Google Таблицей ещё подключается.' }, 503);
      const response = await fetcher(bridge, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, token, apiKey: deps.apiKey }), redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error('Google не подтвердил сохранение. Проверьте список перед повторной попыткой.');
      const result = await response.json();
      if (result.error) return json({ error: String(result.error) }, 400);
      if (result.ok !== true || result.groupId !== input.groupId || result.name !== input.name) throw new Error('Google не подтвердил сохранение. Проверьте список перед повторной попыткой.');
      // A failed refresh must not disguise a confirmed write as a failed save.
      let timeline;
      try { timeline = await readMediaWorkbook(fetcher); } catch { /* normal 60-second refresh will pick up the confirmed row */ }
      return json({ saved: true, exists: result.exists === true, timeline, workbookUrl: MEDIA_WORKBOOK_URL });
    } catch (e) {
      return json({ error: e instanceof SyntaxError ? 'Некорректный формат данных.' : 'Не удалось получить подтверждение от таблицы. Проверьте список перед повторной попыткой.' }, 502);
    }
  };
}
