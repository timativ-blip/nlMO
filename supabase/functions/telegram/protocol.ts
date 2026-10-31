const encoder = new TextEncoder();
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export function equalSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = encoder.encode(a),
    y = encoder.encode(b);
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) difference |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return difference === 0;
}
async function hmac(key: Uint8Array, value: string) {
  const secret = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', secret, encoder.encode(value)));
}
export async function validateInitData(raw: string, token: string, now = Date.now()): Promise<{ id: number; hash: string }> {
  if (!token || !raw || raw.length > 16384) throw new Error('Откройте мини-приложение заново из Telegram.');
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new Error('Некорректные данные входа Telegram.');
  const hash = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Подпись Telegram не подтверждена.');
  const at = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(at) || at <= 0 || at * 1000 > now + 30000 || now - at * 1000 > 10 * 60 * 1000)
    throw new Error('Данные входа устарели. Закройте и откройте мини-приложение из бота.');
  const data = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = await hmac(encoder.encode('WebAppData'), token);
  const expected = [...(await hmac(secret, data))].map((n) => n.toString(16).padStart(2, '0')).join('');
  if (!equalSecret(hash, expected)) throw new Error('Подпись Telegram не подтверждена.');
  let user: { id?: unknown };
  try {
    user = JSON.parse(params.get('user') ?? 'null');
  } catch {
    throw new Error('Не удалось определить пользователя Telegram.');
  }
  if (!user || !Number.isSafeInteger(user.id) || (user.id as number) <= 0)
    throw new Error('Не удалось определить пользователя Telegram.');
  return { id: user.id as number, hash };
}
export function appUrl(base: string, path = '') {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Для мини-приложения нужен HTTPS-адрес сайта.');
  url.hash = '';
  url.search = '';
  url.searchParams.set('tg', '1');
  const route = path.replace(/^#/, '');
  if (
    route &&
    /^\/(home|tasks|calendar|team|reports|analytics|media|daily|profile|settings|pulse)(\/[A-Za-z0-9_-]+)*$/.test(route)
  )
    url.searchParams.set('view', route);
  return url.toString();
}
export function splitText(text: string, size = 3500): string[] {
  const parts: string[] = [];
  while (text.length > size) {
    let end = text.lastIndexOf('\n', size);
    if (end < size / 2) end = size;
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(0, end));
    text = text.slice(end).replace(/^\n/, '');
  }
  if (text) parts.push(text);
  return parts;
}
