import { Activity, BarChart3, Bell, ClipboardCheck, Megaphone, CalendarDays, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, FileText, FlaskConical, Home as HomeIcon, LogOut, MapPin, Menu, Plus, Search, Settings, User as UserIcon, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isOverdue } from './data/calc';
import * as P from './data/perm';
import { DEMO_MODE, markRead, onSaveError, signOut, switchUser, useAppState, usePhase, useSyncing } from './data/store';
import AuthGate from './pages/Auth';
import type { Notification } from './data/types';
import { roleLabel } from './data/types';
import { fmtAgo, fmtDayMonth, todayISO, addDays } from './lib/date';
import { go, useRoute } from './lib/router';
import AnalyticsPage from './pages/Analytics';
import MediaPage from './pages/Media';
import DailyPage from './pages/Daily';
import PulsePage from './pages/Pulse';
import CalendarPage, { EventDrawer, NewEventModal } from './pages/Calendar';
import Home from './pages/Home';
import ImportPage from './pages/Import';
import { ProfilePage, SettingsPage } from './pages/Profile';
import ReportsPage from './pages/Reports';
import { NewTaskModal, TaskDrawer } from './pages/TaskPanels';
import TasksPage from './pages/Tasks';
import TeamPage from './pages/Team';
import { openEvent, openNewTask, openTask } from './ui/global';
import { useLookup, useMe } from './ui/hooks';
import { Avatar, Button, Modal, Toaster, toast, usePopover } from './ui/kit';
import { RecordsModal } from './ui/widgets';
import { Onboarding } from './ui/onboarding';
import { ThemeToggle, useTheme } from './ui/appearance';

const NAV_ALL: { id: string; label: string; icon: typeof HomeIcon; staffOnly?: boolean }[] = [
  { id: 'home', label: 'Главная', icon: HomeIcon },
  { id: 'pulse', label: 'Пульс области', icon: Activity, staffOnly: true },
  { id: 'tasks', label: 'Задачи', icon: CheckSquare },
  { id: 'calendar', label: 'Календарь', icon: CalendarDays },
  { id: 'team', label: 'Команда', icon: Users },
  { id: 'reports', label: 'Отчёты', icon: FileText },
  { id: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { id: 'media', label: 'Медиа', icon: Megaphone },
  { id: 'daily', label: 'Отчёт дня', icon: ClipboardCheck, staffOnly: true },
];

export default function App() {
  const { phase } = usePhase();
  useEffect(() => { onSaveError((m) => toast(m, 'error')); }, []);
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('auth-preview')) return <><AuthGate preview /><Toaster /></>;
  if (phase !== 'ready') return <><AuthGate /><Toaster /></>;
  return <Workspace />;
}

function Workspace() {
  const route = useRoute();
  const page = route.parts[0] || 'home';
  const me = useMe();
  const s = useAppState();
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { resolved: theme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('kc-sidebar-collapsed') === '1'; } catch { return false; } });
  const toggleSidebar = () => { const next = !collapsed; setCollapsed(next); try { localStorage.setItem('kc-sidebar-collapsed', next ? '1' : '0'); } catch { /* optional preference */ } };

  const syncing = useSyncing();
  useEffect(() => { window.scrollTo(0, 0); }, [page]);
  useEffect(() => {
    const title = NAV_ALL.find((n) => n.id === page)?.label ?? (page === 'profile' ? 'Профиль' : page === 'settings' ? 'Настройки' : page === 'import' ? 'Импорт' : '');
    document.title = `${title ? title + ' · ' : ''}Командный центр | Московская область`;
  }, [page]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      else if (!typing && !document.querySelector('.overlay, .drawer') && e.key === '/') { e.preventDefault(); setSearchOpen(true); }
      else if (!typing && !document.querySelector('.overlay, .drawer') && e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && P.canCreateTask(me)) { e.preventDefault(); openNewTask(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [me]);

  const NAV = NAV_ALL.filter((n) => !n.staffOnly || me.role !== 'member');
  const dailyMissing = P.mustReportDaily(me) && !s.dailyReports.some((r) => r.userId === me.id && r.day === todayISO());
  const reviewCount = s.tasks.filter((t) => P.canReview(me, t)).length;
  const myOverdue = s.tasks.filter((t) => (t.assigneeId === me.id || t.coAssigneeIds.includes(me.id)) && isOverdue(t)).length;

  let content;
  switch (page) {
    case 'tasks': content = <TasksPage route={route} />; break;
    case 'calendar': content = <CalendarPage route={route} />; break;
    case 'team': content = <TeamPage route={route} />; break;
    case 'reports': content = <ReportsPage route={route} />; break;
    case 'analytics': content = <AnalyticsPage route={route} />; break;
    case 'media': content = <MediaPage route={route} />; break;
    case 'pulse': content = <PulsePage />; break;
    case 'daily': content = <DailyPage />; break;
    case 'profile': content = <ProfilePage />; break;
    case 'settings': content = <SettingsPage />; break;
    case 'import': content = <ImportPage />; break;
    default: content = <Home />;
  }

  return (
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <a href="#main" className="sr-only">Перейти к содержимому</a>
      <aside id="workspace-navigation" className="sidebar" aria-label="Основная навигация">
        <div className="sidebar-header">
          <div className="brand">
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}logo-${theme === 'dark' ? 'light' : 'dark'}.png`} alt="Новые люди · Московская область" />
            <div className="brand-name">Командный центр<span>Московская область</span></div>
          </div>
          <button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-controls="workspace-navigation" aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'} aria-expanded={!collapsed}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>
        </div>
        <span className="nav-caption">Рабочее пространство</span>
        {NAV.map((n) => (
          <a key={n.id} href={`#/${n.id}`} className={`nav-item ${page === n.id ? 'active' : ''}`} aria-current={page === n.id ? 'page' : undefined} aria-label={n.label} title={collapsed ? n.label : undefined}>
            <n.icon size={19} strokeWidth={1.8} /><span className="nav-label">{n.label}</span>
            {n.id === 'daily' && dailyMissing && <span className="count" title="Отчёт за сегодня ещё не сдан">1</span>}
            {n.id === 'tasks' && reviewCount + myOverdue > 0 && <span className="count" title="На проверке у вас и ваши просрочки">{reviewCount + myOverdue}</span>}
          </a>
        ))}
        <div className="nav-sep" />
        <a href="#/profile" aria-label="Профиль" title={collapsed ? 'Профиль' : undefined} className={`nav-item ${page === 'profile' ? 'active' : ''}`}><UserIcon size={19} /><span className="nav-label">Профиль</span></a>
        <a href="#/settings" aria-label="Настройки" title={collapsed ? 'Настройки' : undefined} className={`nav-item ${page === 'settings' || page === 'import' ? 'active' : ''}`}><Settings size={19} /><span className="nav-label">Настройки</span></a>
        <div className="side-foot">
          {DEMO_MODE ? <div className="demo-chip"><FlaskConical size={13} />Деморежим</div> : <div className="small row sync-status"><span className={`sync-dot ${syncing ? 'busy' : ''}`} />{syncing ? 'Сохраняю…' : 'Всё сохранено'}</div>}
          <div className="small side-date">Время московское · {fmtDayMonth(todayISO())}</div>
        </div>
      </aside>

      <div className="main">
        {DEMO_MODE && <div className="demo-banner no-print"><FlaskConical size={14} /><span className="demo-long">Деморежим: вымышленные данные хранятся только в этом браузере. Роль можно переключить в меню профиля.</span><span className="demo-short">Деморежим · данные только в этом браузере</span></div>}
        <header className="topbar">
          <div className="section-heading hide-sm"><span>Рабочее пространство</span><b>{NAV_ALL.find((n) => n.id === page)?.label ?? (page === 'profile' ? 'Профиль' : 'Настройки')}</b></div>
          <img className="brand-logo-sm mobile-only" src={`${import.meta.env.BASE_URL}logo-${theme === 'dark' ? 'light' : 'dark'}.png`} alt="Новые люди" />
          <button className="search-btn" onClick={() => setSearchOpen(true)} aria-label="Поиск по людям, задачам и округам">
            <Search size={17} /><span className="grow" style={{ textAlign: 'left' }}>Найти человека, задачу, округ</span><span className="kbd">Ctrl K</span>
          </button>
          <span className="spacer hide-sm" />
          {P.canCreateTask(me) && <Button variant="primary" icon={Plus} onClick={() => openNewTask()} className="hide-sm">Задача</Button>}
          <ThemeToggle />
          <Notifications />
          <ProfileMenu />
        </header>
        <main id="main" className="content" tabIndex={-1}><div className="page-enter" key={page}>{content}</div></main>
      </div>

      <nav className="bottom-nav" aria-label="Навигация">
        {NAV.filter((n) => ['home', 'tasks', 'calendar', 'team'].includes(n.id)).map((n) => (
          <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => go(`/${n.id}`)} aria-current={page === n.id ? 'page' : undefined}><n.icon size={21} />{n.label}</button>
        ))}
        <button className={['pulse', 'daily', 'reports', 'analytics', 'media', 'profile', 'settings'].includes(page) ? 'active' : ''} onClick={() => setMoreOpen(true)}><Menu size={21} />Ещё</button>
      </nav>
      {P.canCreateTask(me) && <button className="fab" aria-label="Новая задача" onClick={() => openNewTask()}><Plus size={26} /></button>}

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Разделы">
        <div className="col" style={{ gap: 4 }}>
          {[...(me.role !== 'member' ? [{ id: 'pulse', label: 'Пульс области', icon: Activity }, { id: 'daily', label: 'Отчёт дня', icon: ClipboardCheck }] : []), { id: 'reports', label: 'Отчёты', icon: FileText }, { id: 'analytics', label: 'Аналитика и рейтинг', icon: BarChart3 }, { id: 'media', label: 'Медиа: Пиши-Делись и группы', icon: Megaphone }, { id: 'profile', label: 'Профиль', icon: UserIcon }, { id: 'settings', label: 'Настройки и импорт', icon: Settings }].map((n) => (
            <button key={n.id} className="menu-item" style={{ minHeight: 48, borderRadius: 10 }} onClick={() => { setMoreOpen(false); go(`/${n.id}`); }}><n.icon size={20} />{n.label}</button>
          ))}
        </div>
      </Modal>

      <Onboarding />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <TaskDrawer />
      <EventDrawer />
      <NewTaskModal />
      <NewEventModal />
      <RecordsModal />
      <Toaster />
    </div>
  );
}

/* ───────── Уведомления ───────── */
function Notifications() {
  const s = useAppState();
  const me = useMe();
  const { open, setOpen, ref } = usePopover();
  const today = todayISO();
  const list = useMemo(() => {
    const stored = s.notifications.filter((n) => n.userId === me.id && s.ui.notify[n.kind] !== false);
    // Напоминания о сроках формируются автоматически из задач
    const deadlines: Notification[] = DEMO_MODE && s.ui.notify.deadline ? s.tasks.filter((t) => t.assigneeId === me.id && (t.status === 'new' || t.status === 'in_progress') && t.due >= today && t.due <= addDays(today, 1)).map((t) => ({ id: `dl-${t.id}`, userId: me.id, text: `Срок ${t.due === today ? 'сегодня' : 'завтра'}: «${t.title}»`, at: new Date().toISOString(), read: true, link: `#/tasks/${t.id}`, kind: 'deadline' as const })) : [];
    return [...deadlines, ...stored].slice(0, 30);
  }, [s.notifications, s.tasks, s.ui.notify, me.id, today]);
  const unread = list.filter((n) => !n.read).length;
  const openLink = (n: Notification) => {
    setOpen(false);
    if (!n.read && !n.id.startsWith('dl-')) markRead([n.id]);
    const m = n.link.match(/^#\/tasks\/(.+)$/);
    const e = n.link.match(/^#\/calendar\/(.+)$/);
    if (m) openTask(m[1]); else if (e) openEvent(e[1]); else location.hash = n.link;
  };
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <Button variant="ghost" iconOnly icon={Bell} className="icon-btn" aria-label={`Уведомления${unread ? `, непрочитанных: ${unread}` : ''}`} aria-expanded={open} onClick={() => setOpen(!open)} />
      {unread > 0 && <span className="dot-badge" aria-hidden>{unread}</span>}
      {open && (
        <div className="popover" role="dialog" aria-label="Уведомления">
          <div className="row" style={{ padding: '12px 14px' }}><b className="grow">Уведомления</b>{unread > 0 && <Button size="sm" variant="ghost" onClick={() => markRead()}>Прочитать все</Button>}</div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {list.length === 0 && <div className="small muted" style={{ padding: '16px 14px', borderTop: '1px solid var(--border)' }}>Новых уведомлений нет. Здесь появятся назначения, комментарии, решения по проверке и изменения мероприятий.</div>}
            {list.map((n) => (
              <button key={n.id} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => openLink(n)}>
                <span className="n-icon">{n.kind === 'event' ? <CalendarDays size={15} /> : n.kind === 'report' ? <FileText size={15} /> : n.kind === 'deadline' ? <Bell size={15} /> : n.kind === 'media' ? <Megaphone size={15} /> : <CheckSquare size={15} />}</span>
                <span className="grow"><span className="n-text small" style={{ display: 'block' }}>{n.text}</span><span className="small muted">{n.id.startsWith('dl-') ? 'напоминание' : fmtAgo(n.at)}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Профиль и демо-переключатель ───────── */
function ProfileMenu() {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const { open, setOpen, ref } = usePopover();
  const personas = useMemo(() => {
    const istraCoord = s.districts.find((d) => d.id === '121')?.coordinatorId;
    const anna = s.users.find((u) => u.name === 'Анна Соколова');
    return [s.users.find((u) => u.role === 'head'), istraCoord ? L.user(istraCoord) : undefined, s.users.find((u) => u.role === 'staff'), anna].filter(Boolean) as typeof s.users;
  }, [s.users, s.districts, L]);
  const [other, setOther] = useState('');
  const pick = (id: string) => { switchUser(id); setOpen(false); toast(`Вы вошли как ${L.user(id)?.name} (${roleLabel(L.user(id)!)})`); };
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="row btn btn-ghost" style={{ paddingLeft: 4 }} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Меню профиля">
        <Avatar user={me} size={32} />
        <span className="col hide-sm" style={{ gap: 0, alignItems: 'flex-start' }}><b style={{ fontSize: 13 }}>{me.name}</b><span className="small muted" style={{ fontWeight: 500 }}>{roleLabel(me)}</span></span>
        <ChevronDown size={15} className="hide-sm" />
      </button>
      {open && (
        <div className="popover" style={{ width: 340 }}>
          <div className="row" style={{ padding: 14 }}><Avatar user={me} size={40} /><div className="grow"><b>{me.name}</b><div className="small muted">{me.position} · {L.dname(me.districtId)}</div></div></div>
          <button className="menu-item" onClick={() => { setOpen(false); go('/profile'); }}><UserIcon size={16} />Мой профиль</button>
          <button className="menu-item" onClick={() => { setOpen(false); go(`/team/people/${me.id}`); }}><MapPin size={16} />Мои задачи и результаты</button>
          <button className="menu-item" onClick={() => { setOpen(false); go('/settings'); }}><Settings size={16} />Настройки</button>
          {DEMO_MODE && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px 14px', background: '#fffbea' }}>
              <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}><FlaskConical size={13} style={{ verticalAlign: -2 }} /> Демо: войти как</div>
              {personas.map((u) => (
                <button key={u.id} className={`menu-item ${u.id === me.id ? 'active' : ''}`} style={{ padding: '7px 6px', borderRadius: 8 }} onClick={() => pick(u.id)}>
                  <Avatar user={u} size={26} /><span className="grow"><span style={{ display: 'block', fontWeight: 600 }}>{u.name}</span><span className="small muted">{roleLabel(u)}{u.districtId ? ` · ${L.dname(u.districtId)}` : ''}</span></span>
                </button>
              ))}
              <select className="select select-sm" style={{ marginTop: 6 }} value={other} onChange={(e) => { setOther(''); if (e.target.value) pick(e.target.value); }} aria-label="Другой пользователь">
                <option value="">Другой пользователь…</option>
                {s.users.map((u) => <option key={u.id} value={u.id}>{u.name} — {roleLabel(u)}</option>)}
              </select>
              <div className="small muted" style={{ marginTop: 6 }}>В рабочей версии вход по почте/телефону, переключения ролей нет.</div>
            </div>
          )}
          {!DEMO_MODE && <button className="menu-item" onClick={() => { setOpen(false); signOut(); }}><LogOut size={16} />Выйти</button>}
        </div>
      )}
    </div>
  );
}

/* ───────── Глобальный поиск ───────── */
function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const out: { group: string; label: string; sub: string; action: () => void }[] = [];
    s.users.filter((u) => u.active && `${u.name} ${u.email} ${u.position}`.toLowerCase().includes(t)).slice(0, 5).forEach((u) => out.push({ group: 'Люди', label: u.name, sub: `${roleLabel(u)} · ${L.dname(u.districtId)}`, action: () => go(`/team/people/${u.id}`) }));
    s.districts.filter((d) => d.name.toLowerCase().includes(t)).forEach((d) => out.push({ group: 'Округа', label: d.name, sub: `Координатор: ${L.user(d.coordinatorId)?.name ?? '—'}`, action: () => go(`/team/districts/${d.id}`) }));
    s.tasks.filter((x) => P.canSeeTask(me, x) && x.title.toLowerCase().includes(t)).sort((a, b) => b.due.localeCompare(a.due)).slice(0, 7).forEach((x) => out.push({ group: 'Задачи', label: x.title, sub: `${L.dname(x.districtId)} · ${L.user(x.assigneeId)?.name} · до ${fmtDayMonth(x.due)}`, action: () => openTask(x.id) }));
    s.events.filter((e) => P.canSeeEvent(me, e) && e.title.toLowerCase().includes(t)).slice(0, 4).forEach((e) => out.push({ group: 'Мероприятия', label: e.title, sub: fmtDayMonth(e.start), action: () => openEvent(e.id) }));
    return out;
  }, [q, s, me, L]);
  const choose = (i: number) => { const r = results[i]; if (r) { onClose(); r.action(); } };
  useEffect(() => { listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  return (
    <Modal open={open} onClose={onClose} title="Поиск" width={620}>
      <div className="search-input" style={{ maxWidth: 'none' }}>
        <Search size={16} />
        <input className="input" autoFocus placeholder="Имя, задача, округ или мероприятие" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(sel + 1, results.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(sel - 1, 0)); } if (e.key === 'Enter') choose(sel); }}
          role="combobox" aria-expanded={results.length > 0} aria-controls="search-results" aria-label="Поиск" style={{ height: 44 }} />
      </div>
      <div id="search-results" role="listbox" ref={listRef} style={{ marginTop: 10, maxHeight: 420, overflowY: 'auto' }}>
        {q && results.length === 0 && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>Ничего не нашли по запросу «{q}». Проверьте написание или попробуйте часть слова.</div>}
        {!q && <div className="small muted" style={{ padding: 8 }}>Подсказка: ↑ ↓ — выбор, Enter — открыть. Быстрые клавиши: N — новая задача, / — поиск.</div>}
        {results.map((r, i) => (
          <div key={i}>
            {(i === 0 || results[i - 1].group !== r.group) && <div className="small muted" style={{ padding: '10px 10px 4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{r.group}</div>}
            <button role="option" aria-selected={i === sel} className={`menu-item ${i === sel ? 'active' : ''}`} style={{ borderRadius: 10 }} onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
              <span className="grow"><span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>{r.label}</span><span className="small muted ellipsis" style={{ display: 'block' }}>{r.sub}</span></span>
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
