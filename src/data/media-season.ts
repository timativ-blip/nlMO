// The same server timeline supplies the website and scheduled Telegram summaries.
import { MONTHS_NOM } from '../lib/date';
import { isPdTimeline } from '../../supabase/functions/_shared/media-timeline';
import type { PdData } from './media-types';
export { MEDIA_SEASONS, SEASON_11_URL, parseCsv, buildSeason, buildTimeline } from '../../supabase/functions/_shared/media-timeline';

export function mediaMonths(data: PdData) {
  return [...new Set([...data.posts.map((p) => p[0].slice(0, 7)), ...Object.keys(data.seasons ?? {})])].sort();
}

export function mediaMonth(months: string[], selected: string) {
  return months.includes(selected) ? selected : months[months.length - 1] ?? '';
}

export function mediaSeasonTitle(data: PdData, month: string) {
  const [year, n] = month.split('-').map(Number);
  const season = data.seasons?.[month];
  return `${season ? `${season} сезон · ` : ''}${MONTHS_NOM[n - 1]} ${year}`;
}

export async function loadMediaTimeline(url: string, signal: AbortSignal): Promise<PdData> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Не удалось обновить данные сезонов.');
  const data = await response.json() as PdData;
  if (!isPdTimeline(data)) throw new Error('Некорректная выгрузка «Пиши-Делись».');
  return data;
}
