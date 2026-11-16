/** Telegram monitoring stays visible, but posting gaps are not an assessment signal. */
export const ASSESSED_NETWORKS = ['vk'] as const;
export const TELEGRAM_ASSESSMENT_NOTE = 'Telegram временно не влияет на оценку округа: у участников есть сложности с доступом. Даты постов показаны справочно; напоминания о паузах в Telegram отключены.';
interface Channel { status: string; last?: string }
export type PublicationNetwork = 'vk' | 'tg';
export function publicationAssessment(channel: Channel | null, network: PublicationNetwork, now = Date.now()) {
  const assessed = ASSESSED_NETWORKS.some(n => n === network);
  let days: number | null = null;
  if (channel?.status === 'empty') days = Infinity;
  else if (channel?.status === 'ok' && channel.last) {
    const last = Date.parse(channel.last);
    if (Number.isFinite(last) && last <= now) days = Math.floor((now + 10800000) / 86400000) - Math.floor((last + 10800000) / 86400000);
  }
  const cls = !assessed || days === null ? 'none' : days <= 1 ? 'fresh' : days <= 3 ? 'warn' : 'bad';
  return { assessed, days, cls };
}
export function silentGroupCount(groups: { vk: Channel | null; tg: Channel | null }[], now = Date.now()) {
  const known = groups.flatMap(g => ASSESSED_NETWORKS.map(n => publicationAssessment(g[n], n, now))).filter(s => s.days !== null);
  return known.length ? known.filter(s => s.cls === 'bad').length : null;
}
