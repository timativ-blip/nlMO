// Первый вход: подключить Telegram-бота (напоминания), установить приложение на телефон,
// напомнить про ежедневный отчёт. Плюс постоянные подсказки на главной, пока бот не подключён.
import { CheckCircle2, ClipboardCheck, Download, Send, Smartphone } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import * as P from '../data/perm';
import { connectTelegram, DEMO_MODE, useAppState } from '../data/store';
import { todayISO } from '../lib/date';
import { go } from '../lib/router';
import { useMe } from './hooks';
import { Button, Modal, toast } from './kit';

/* ───────── установка как приложение ───────── */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; ping(); });
  window.addEventListener('appinstalled', () => { deferred = null; ping(); });
}
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export function useInstall() {
  const canPrompt = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => !!deferred);
  const install = async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const r = await deferred.userChoice;
    deferred = null; ping();
    return r.outcome === 'accepted';
  };
  return { canPrompt, install, installed: isStandalone() };
}

export function InstallHelp() {
  const { canPrompt, install, installed } = useInstall();
  if (installed) return <div className="small muted">Приложение уже установлено — вы открыли его с экрана «Домой».</div>;
  if (canPrompt) return <Button variant="primary" icon={Download} onClick={async () => { if (await install()) toast('Иконка появится на экране телефона'); }}>Установить приложение</Button>;
  if (isIOS()) return (
    <ol className="install-steps small">
      <li>Откройте сайт в Safari.</li>
      <li>Нажмите «Поделиться» (квадрат со стрелкой вверх).</li>
      <li>Выберите «На экран “Домой”» → «Добавить».</li>
    </ol>
  );
  return (
    <ol className="install-steps small">
      <li>Откройте сайт в Chrome на телефоне.</li>
      <li>Меню ⋮ → «Установить приложение» или «Добавить на главный экран».</li>
    </ol>
  );
}

/* ───────── Telegram ───────── */
export async function openTelegramLink() {
  // окно открываем сразу, иначе браузер заблокирует его как всплывающее
  const w = window.open('', '_blank');
  try {
    const url = await connectTelegram();
    if (w) w.location.href = url; else location.href = url;
    toast('Нажмите «Старт» в Telegram — бот подтвердит подключение');
  } catch (e) {
    w?.close();
    toast((e as Error).message, 'error');
  }
}

const seenKey = (id: string) => `kc_onboarded_${id}`;
const readSeen = (id: string) => { try { return localStorage.getItem(seenKey(id)) === '1'; } catch { return true; } };

export function Onboarding() {
  const s = useAppState();
  const me = useMe();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!readSeen(me.id)) setOpen(true); }, [me.id]);
  const close = () => { try { localStorage.setItem(seenKey(me.id), '1'); } catch { /* приватный режим */ } setOpen(false); };
  const linked = !!s.extras?.telegramLinked;
  const daily = P.mustReportDaily(me);
  return (
    <Modal open={open} onClose={close} title={`Добро пожаловать, ${me.name.split(' ')[0]}!`} footer={<Button variant="primary" onClick={close}>Понятно, начать работу</Button>}>
      <div className="col" style={{ gap: 10 }}>
        <p className="muted" style={{ margin: 0 }}>Три шага, чтобы ничего не пропускать:</p>
        <div className={`onb-step ${linked ? 'done' : ''}`}>
          <span className="onb-ic">{linked ? <CheckCircle2 size={20} /> : <Send size={20} />}</span>
          <div className="col grow" style={{ gap: 6 }}>
            <b>Подключите Telegram-бота{s.extras?.telegramBot ? ` @${s.extras.telegramBot}` : ''}</b>
            <span className="small muted">Под своим аккаунтом: бот будет присылать новые задачи, напоминания о сроках{daily ? ', напоминание о ежедневном отчёте в 18:00' : ''} и решения по проверке.</span>
            {linked ? <span className="small" style={{ color: '#1f8a5f', fontWeight: 600 }}>Подключено</span> : DEMO_MODE ? <span className="small muted">В деморежиме бот не подключается.</span> : <div><Button variant="primary" icon={Send} onClick={openTelegramLink}>Подключить Telegram</Button></div>}
          </div>
        </div>
        <div className="onb-step">
          <span className="onb-ic"><Smartphone size={20} /></span>
          <div className="col grow" style={{ gap: 6 }}>
            <b>Установите приложение на телефон</b>
            <span className="small muted">Иконка на экране, открывается без браузера — как обычное приложение.</span>
            <InstallHelp />
          </div>
        </div>
        {daily && (
          <div className="onb-step">
            <span className="onb-ic"><ClipboardCheck size={20} /></span>
            <div className="col grow" style={{ gap: 6 }}>
              <b>Сдавайте отчёт дня</b>
              <span className="small muted">Каждый рабочий день коротко: что сделано, план на завтра, проблемы. Раздел «Отчёт дня» в меню.</span>
              <div><Button onClick={() => { close(); go('/daily'); }}>Открыть «Отчёт дня»</Button></div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Подсказки на главной: бот не подключён, отчёт за сегодня не сдан */
export function HomeNudges() {
  const s = useAppState();
  const me = useMe();
  const linked = !!s.extras?.telegramLinked;
  const dailyMissing = P.mustReportDaily(me) && !s.dailyReports.some((r) => r.userId === me.id && r.day === todayISO());
  if ((linked || DEMO_MODE) && !dailyMissing) return null;
  return (
    <div className="col" style={{ gap: 8, marginBottom: 16 }}>
      {dailyMissing && (
        <div className="callout warn" style={{ alignItems: 'center' }}><ClipboardCheck size={17} /><span className="grow">Отчёт за сегодня ещё не сдан.</span><Button size="sm" variant="primary" onClick={() => go('/daily')}>Заполнить</Button></div>
      )}
      {!linked && !DEMO_MODE && (
        <div className="callout info" style={{ alignItems: 'center' }}><Send size={17} /><span className="grow">Подключите Telegram-бота — напоминания о задачах, сроках и отчётах будут приходить вам в личные сообщения.</span><Button size="sm" variant="primary" onClick={openTelegramLink}>Подключить</Button></div>
      )}
    </div>
  );
}
