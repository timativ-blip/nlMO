import { AUTH_STORAGE_KEY, BACKEND, FUNCTIONS_URL, sb } from './supabase';
import { withDeadline } from './deadline';

export interface TelegramApp {
  initData: string;
  colorScheme?: 'light' | 'dark';
  viewportStableHeight?: number;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  ready(): void;
  expand(): void;
  close(): void;
  openTelegramLink?(url: string): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(event: string, handler: () => void): void;
  offEvent?(event: string, handler: () => void): void;
  BackButton?: { show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void };
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramApp };
  }
}
const params = new URLSearchParams(location.search);
export const isTelegramLaunch =
  BACKEND &&
  !params.has('tg_login') &&
  (params.has('tg') || /(?:^#|&)tgWebAppData=/.test(location.hash) || !!window.Telegram?.WebApp?.initData);
let initialization: Promise<{ userId: string; app: TelegramApp }> | null = null;
async function sdk(): Promise<TelegramApp> {
  if (window.Telegram?.WebApp?.initData) return window.Telegram.WebApp;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.async = true;
    const timer = setTimeout(() => reject(new Error('Telegram не загрузился. Повторно откройте приложение из бота.')), 8000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Не удалось загрузить Telegram. Можно войти почтой.'));
    };
    document.head.appendChild(script);
  });
  const app = window.Telegram?.WebApp;
  if (!app?.initData) throw new Error('Откройте мини-приложение кнопкой «Открыть сайт» в боте.');
  return app;
}
export function initializeTelegram() {
  if (initialization) return initialization;
  initialization = (async () => {
    const app = await sdk();
    app.ready();
    app.expand();
    document.documentElement.dataset.telegram = '1';
    const view = new URLSearchParams(location.search).get('view') ?? '/home';
    if (/(?:^#|&)tgWebAppData=/.test(location.hash)) {
      const target =
        /^\/(home|tasks|calendar|team|reports|analytics|media|daily|profile|settings|pulse)(\/[A-Za-z0-9_-]+)*$/.test(view)
          ? view
          : '/home';
      history.replaceState(null, '', location.pathname + location.search + '#' + target);
    }
    const { data: session } = await withDeadline(
      () => sb!.auth.getSession(),
      12000,
      'Не удалось проверить вход. Повторно откройте мини-приложение.',
    );
    const result = await withDeadline(
      async (signal) => {
        const response = await fetch(`${FUNCTIONS_URL}/telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_KEY,
            ...(session.session?.access_token ? { Authorization: `Bearer ${session.session.access_token}` } : {}),
          },
          body: JSON.stringify({ action: 'mini_auth', initData: app.initData }),
          signal,
          cache: 'no-store',
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Не удалось войти через Telegram.');
        if (typeof body.userId !== 'string' || !body.userId) throw new Error('Сервер не подтвердил пользователя Telegram.');
        return body as { userId: string; alreadyAuthenticated?: boolean; access_token?: string; refresh_token?: string };
      },
      20000,
      'Сервер не ответил. Повторно откройте мини-приложение или войдите почтой.',
    );
    if (!result.alreadyAuthenticated) {
      if (!result.access_token || !result.refresh_token) throw new Error('Не удалось подтвердить вход через Telegram.');
      const { error } = await withDeadline(
        () => sb!.auth.setSession({ access_token: result.access_token!, refresh_token: result.refresh_token! }),
        12000,
        'Не удалось завершить вход. Повторно откройте мини-приложение.',
      );
      if (error) throw new Error('Не удалось завершить вход. Повторно откройте мини-приложение.');
    } else if (session.session?.user.id !== result.userId)
      throw new Error('Учётная запись изменилась. Повторно откройте мини-приложение.');
    return { userId: result.userId, app };
  })();
  return initialization;
}
export function enterPasswordLogin() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`);
  const url = new URL(location.href);
  const route = location.hash.replace(/^#/, '') || url.searchParams.get('view') || '/home';
  url.hash = /^\/(home|tasks|calendar|team|reports|analytics|media|daily|profile|settings|pulse)(\/[A-Za-z0-9_-]+)*$/.test(route)
    ? route
    : '/home';
  url.search = '';
  url.searchParams.set('tg_login', 'manual');
  location.replace(url.href);
}
