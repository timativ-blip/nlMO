import { useEffect, useState, type ReactNode } from 'react';
import { initializeTelegram, enterPasswordLogin, isTelegramLaunch, type TelegramApp } from '../lib/telegram';
import { useAppState, usePhase } from '../data/store';
import { useTheme } from './appearance';
import { Button } from './kit';

export function TelegramMiniApp({ children }: { children: ReactNode }) {
  const state = useAppState(),
    phase = usePhase();
  const { resolved: theme } = useTheme();
  const [ready, setReady] = useState<{ userId: string; app: TelegramApp } | null>(null);
  const [error, setError] = useState('');
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!isTelegramLaunch) return;
    let active = true;
    initializeTelegram()
      .then((result) => {
        if (active) setReady(result);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (ready && state.session.userId === ready.userId && phase.phase !== 'loading') setEntered(true);
  }, [ready, state.session.userId, phase.phase]);
  useEffect(() => {
    if (!ready) return;
    const app = ready.app;
    const resize = () => {
      const top = Math.max(app.safeAreaInset?.top ?? 0, app.contentSafeAreaInset?.top ?? 0);
      const bottom = Math.max(app.safeAreaInset?.bottom ?? 0, app.contentSafeAreaInset?.bottom ?? 0);
      document.documentElement.style.setProperty('--mini-safe-top', `${top}px`);
      document.documentElement.style.setProperty('--mini-safe-bottom', `${bottom}px`);
    };
    resize();
    for (const event of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) app.onEvent?.(event, resize);
    return () => {
      for (const event of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) app.offEvent?.(event, resize);
    };
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    try {
      ready.app.setHeaderColor?.(theme === 'dark' ? '#101416' : '#f3f6f5');
      ready.app.setBackgroundColor?.(theme === 'dark' ? '#101416' : '#f3f6f5');
    } catch {
      /* Older Telegram clients keep their own header. */
    }
  }, [ready, theme]);
  if (!isTelegramLaunch) return <>{children}</>;
  if (error)
    return (
      <main className="mini-entry">
        <div className="card card-pad col" style={{ maxWidth: 440, gap: 16 }}>
          <h1>Вход через Telegram</h1>
          <p role="alert">{error}</p>
          <Button
            variant="primary"
            onClick={() => {
              try {
                enterPasswordLogin();
              } catch {
                setError('Не удалось обновить вход. Откройте сайт в браузере.');
              }
            }}
          >
            Войти почтой
          </Button>
          <p className="small muted">Подключение к боту выполняется один раз в профиле на сайте.</p>
        </div>
      </main>
    );
  if (!entered && (!ready || state.session.userId !== ready.userId || phase.phase === 'loading'))
    return (
      <main className="mini-entry">
        <div className="card card-pad col" role="status">
          <div className="spinner" />
          <h2>Открываю Командный центр</h2>
          <p className="muted">Проверяю вход и загружаю данные команды…</p>
        </div>
      </main>
    );
  return <>{children}</>;
}
