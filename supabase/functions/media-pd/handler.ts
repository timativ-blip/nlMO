import { type PdData } from '../_shared/media-timeline.ts';
import { readMediaWorkbook } from '../_shared/media-workbook.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body: unknown, status = 200, maxAge = 60) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` } });

// All three named sheets are required. A missing source cannot silently become zero people/posts.
// Rejected posts now live on the season sheet; no deleted-tab request remains.
export function createMediaPdHandler(fetcher: typeof fetch = fetch, now = Date.now) {
  let cache: { at: number; data: PdData } | null = null;
  let loading: Promise<void> | null = null;
  const refresh = async () => {
    const data = await readMediaWorkbook(fetcher);
    data.updated = new Date(now()).toISOString();
    cache = { at: now(), data };
  };
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (!['GET', 'POST'].includes(req.method)) return json({ error: 'method not allowed' }, 405, 0);
    try {
      if (!cache || now() - cache.at >= 60000) {
        if (!loading) loading = refresh().finally(() => { loading = null; });
        await loading;
      }
      return json(cache!.data);
    } catch {
      if (cache && now() - cache.at <= 15 * 60000) return json({ ...cache.data, sourceStatus: 'stale' }, 200, 0);
      return json({ error: 'source unavailable' }, 502, 0);
    }
  };
}
