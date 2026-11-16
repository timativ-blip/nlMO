export const PUSH_KINDS = ['assign','deadline','comment','review','event','report','media','message','meeting'] as const;
export interface Subscription { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } }
export const notificationTitle = (kind: string) => ({ assign:'Новая задача', deadline:'Сроки задач', comment:'Новый комментарий', review:'Проверка результата', event:'Мероприятие', report:'Отчёты команды', media:'Медиа штаба', message:'Новое сообщение', meeting:'Видеовстреча' }[kind] ?? 'Командный центр');
export function validateSubscription(value: unknown): Subscription {
  const s = value as Subscription;
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 2048) throw new Error('Некорректная подписка.');
  const u = new URL(s.endpoint), host = u.hostname.toLowerCase();
  const allowed = ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(host) || host.endsWith('.push.services.mozilla.com') || host.endsWith('.notify.windows.com');
  if (u.protocol !== 'https:' || u.port && u.port !== '443' || u.username || u.password || u.hash || !allowed) throw new Error('Сервис уведомлений не поддерживается.');
  if (!s.keys || !/^[A-Za-z0-9_-]{87}={0,2}$/.test(s.keys.p256dh) || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(s.keys.auth)) throw new Error('Некорректные ключи подписки.');
  return { endpoint:s.endpoint, keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}, expirationTime:typeof s.expirationTime === 'number' ? s.expirationTime : null };
}
export function mutedKinds(value: unknown) {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !PUSH_KINDS.includes(v as typeof PUSH_KINDS[number]))) throw new Error('Некорректные настройки уведомлений.');
  return [...new Set(value)] as string[];
}
export function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff === 0;
}
export function pushPayload(n: {id:string;kind:string;text:string;link:string}) {
  return {id:n.id,kind:n.kind,title:notificationTitle(n.kind),body:n.text.slice(0,300),link:/^#\/[a-z]/.test(n.link) ? n.link : '#/home'};
}
