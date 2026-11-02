import type { PdData } from '../_shared/media-timeline.ts';
export type PdSnapshot = Pick<PdData, 'people' | 'posts' | 'sourceStatus'>;
export function lastPdPost(pd: PdSnapshot | null) {
  return pd?.posts.reduce((latest, post) => /^\d{4}-\d{2}-\d{2}$/.test(post[0]) && post[0] > latest ? post[0] : latest, '') ?? '';
}
export function pdRecent(pd: PdSnapshot | null, from: string) {
  return !!pd && pd.sourceStatus !== 'stale' && lastPdPost(pd) >= from;
}
export function pdWeekLine(pd: PdSnapshot | null, current: number, previous: number, weekEnd: string) {
  if (!pd) return '«Пиши-Делись»: данные недоступны';
  if (pd.sourceStatus === 'stale') return '«Пиши-Делись»: не удалось обновить выгрузку, статистика временно недоступна';
  const last = lastPdPost(pd);
  if (!last) return '«Пиши-Делись»: в выгрузке пока нет публикаций';
  const delta = current === previous ? '=' : current > previous ? `↑${current - previous}` : `↓${previous - current}`;
  const coverage = last < weekEnd ? ` · последние публикации по ${last.slice(8)}.${last.slice(5, 7)}` : '';
  return `Посты «Пиши-Делись»: ${current} (${delta} к пред. неделе)${coverage}`;
}
