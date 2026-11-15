import { ARCHIVE_URL, AUTHORS_URL, buildAuthorRoster, buildSeason, buildTimeline, SEASON_11_URL, type PdData } from './media-timeline.ts';

// Deployment URL is public configuration. No Google credentials or owner tokens leave Google.
export const MEDIA_BRIDGE_URL = 'https://script.google.com/macros/s/AKfycbxMw5mFICxHBjo4ZmM_Ae5akWvu0nDWIvnT86hNAxAJfLhrVHqJhn_gB6uvrHxFg-fMWQ/exec';
export const MEDIA_WORKBOOK_URL = 'https://docs.google.com/spreadsheets/d/14pPkKu5bawgFWmbg5mbongAyCr4n0z-2LAUsfOtxiAk/edit';
export function timelineFromSheets(value: unknown): PdData {
  const v = value as { authors?: unknown; archive?: unknown; season?: unknown };
  if (!v || typeof v.authors !== 'string' || typeof v.archive !== 'string' || typeof v.season !== 'string') throw new Error('Не удалось прочитать рабочую таблицу.');
  const archive = buildSeason(v.archive, buildAuthorRoster(v.authors));
  return { ...buildTimeline(archive, buildSeason(v.season, archive)), workbookUrl: MEDIA_WORKBOOK_URL };
}
export async function readMediaWorkbook(fetcher: typeof fetch = fetch): Promise<PdData> {
  if (MEDIA_BRIDGE_URL) {
    const response = await fetcher(MEDIA_BRIDGE_URL, { signal: AbortSignal.timeout(18000), cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error('Media source unavailable');
    return timelineFromSheets(await response.json());
  }
  const read = async (url: string) => {
    const response = await fetcher(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Media source unavailable');
    return response.text();
  };
  const [authors, archiveText, seasonText] = await Promise.all([read(AUTHORS_URL), read(ARCHIVE_URL), read(SEASON_11_URL)]);
  const archive = buildSeason(archiveText, buildAuthorRoster(authors));
  return buildTimeline(archive, buildSeason(seasonText, archive));
}
