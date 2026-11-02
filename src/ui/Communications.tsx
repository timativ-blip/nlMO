import { ArrowLeft, Check, CheckCheck, MessageCircle, Plus, RefreshCw, Search, Send, Video, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cancelInvitation, createMeeting, initializeCommunications, loadCommunications, loadMeeting, loadMessages, openConversation, openPreparation, openMeetingMinutes, readVisibleMessages, resetCommunications, selectConversation, sendDirectMessage, setMessagePanel, signalDialog, startConversation, useCommunications, visibleDialog } from '../data/communications';
import type { DirectMessage } from '../data/communication-types';
import { DEMO_MODE, useAppState } from '../data/store';
import { go, useRoute } from '../lib/router';
import { useMe } from './hooks';
import { Button, toast } from './kit';
import { InvitationActions, PersonAvatar, PersonName } from './MeetingInvites';
import '../communications.css';

const Preparation = lazy(() => import('./MeetingRoom').then(module => ({ default: module.Preparation })));
const ActiveMeeting = lazy(() => import('./MeetingRoom').then(module => ({ default: module.ActiveMeeting })));
const MeetingMinutes = lazy(() => import('./MeetingMinutes'));
const time = (value: string) => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
export function MessagesButton() {
  const state = useCommunications();
  return <div className="comm-button-wrap"><Button iconOnly icon={MessageCircle} variant="ghost" className="icon-btn" aria-label={`Сообщения${state.unread ? ', непрочитанных: ' + state.unread : ''}`} aria-expanded={state.panelOpen} aria-controls="comm-message-panel" onClick={() => setMessagePanel(!state.panelOpen)} />{state.unread > 0 && <span className="dot-badge" aria-hidden>{state.unread > 99 ? '99+' : state.unread}</span>}</div>;
}
function DeliveryState({ message }: { message: DirectMessage }) {
  if (message.sendState === 'sending') return <span>Отправка…</span>;
  if (message.sendState === 'error') return <span className="comm-error">Не отправлено</span>;
  if (message.readAt) return <span className="comm-read"><CheckCheck size={13} />Прочитано</span>;
  if (message.deliveredAt) return <span><CheckCheck size={13} />Доставлено</span>;
  return <span><Check size={13} />Отправлено</span>;
}
function MeetingCard({ message }: { message: DirectMessage }) {
  const state = useCommunications(); const id = message.meetingId!; const meeting = state.meetings.find(item => item.id === id) ?? state.details[id]?.meeting;
  const peerId = state.conversations.find(item => item.id === message.conversationId)?.peerId;
  const invitation = state.invitations.find(item => item.meetingId === id && item.userId === (message.senderId === state.userId ? peerId : state.userId));
  useEffect(() => { if (!meeting) void loadMeeting(id).catch(() => {}); }, [id, !!meeting]);
  const inactive = meeting?.active === false || invitation && ['declined', 'cancelled', 'expired'].includes(invitation.status);
  return <div className="comm-meeting-message"><Video size={23} /><b>{meeting?.title ?? 'Видеовстреча'}</b><span className="small muted">{meeting?.active === false ? 'Встреча завершена' : invitation?.status === 'declined' ? 'Приглашение отклонено' : invitation?.status === 'cancelled' ? 'Приглашение отменено' : invitation?.status === 'expired' ? 'Приглашение истекло' : invitation?.status === 'joined' ? 'Собеседник присоединился' : invitation?.status === 'accepted' ? 'Приглашение принято' : 'Встреча внутри Командного центра'}</span>{invitation?.userId === state.userId && ['pending', 'accepted'].includes(invitation.status) && meeting?.active ? <InvitationActions invitation={invitation} /> : <Button size="sm" icon={Video} disabled={!!inactive || !state.videoReady} onClick={() => { go('/meetings/' + id); void openPreparation(id).catch(error => toast(error.message, 'error')); }}>Открыть встречу</Button>}{invitation?.inviterId === state.userId && ['pending', 'accepted'].includes(invitation.status) && meeting?.active && <Button size="sm" variant="ghost" onClick={() => void cancelInvitation(invitation.id).catch(error => toast(error.message, 'error'))}>Отменить приглашение</Button>}</div>;
}
function MessagePanel() {
  const state = useCommunications(); const me = useMe(); const route = useRoute();
  const [search, setSearch] = useState(''), [newDialog, setNewDialog] = useState(false), [drafts, setDrafts] = useState<Record<string, string>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false), [visibility, setVisibility] = useState(0);
  const cid = state.selected, conversation = state.conversations.find(item => item.id === cid); const messages = cid ? state.messages[cid] ?? [] : [];
  const panel = useRef<HTMLElement>(null), history = useRef<HTMLDivElement>(null), nearBottom = useRef(true), previousThread = useRef<string | null>(null), typingSent = useRef(0), creatingCall = useRef({ peer: '', id: '' });
  const draft = cid ? drafts[cid] ?? '' : '';
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!state.panelOpen) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [state.panelOpen]);
  useEffect(() => { const changed = () => setVisibility(value => value + 1); document.addEventListener('visibilitychange', changed); window.addEventListener('focus', changed); window.addEventListener('blur', changed); return () => { document.removeEventListener('visibilitychange', changed); window.removeEventListener('focus', changed); window.removeEventListener('blur', changed); }; }, []);
  useEffect(() => {
    if (!cid || !state.panelOpen) return;
    const pulse = () => { void signalDialog(cid, visibleDialog()); };
    pulse(); const timer = setInterval(pulse, 7000);
    return () => { clearInterval(timer); void signalDialog(cid, false); };
  }, [cid, state.panelOpen, visibility]);
  useEffect(() => {
    if (!state.panelOpen) return;
    const previous = document.activeElement as HTMLElement | null; panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.overlay')) { event.preventDefault(); setMessagePanel(false); }
      if (event.key === 'Tab' && matchMedia('(max-width: 600px)').matches && panel.current && !document.querySelector('.comm-incoming-card')) {
        const fields = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, a[href], [tabindex="0"]')]; const first = fields[0], last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus?.(); };
  }, [state.panelOpen]);
  useLayoutEffect(() => { if (!history.current) return; if (previousThread.current !== cid || nearBottom.current) history.current.scrollTop = history.current.scrollHeight; previousThread.current = cid; }, [cid, messages]);
  useEffect(() => {
    if (!cid || !state.panelOpen || !visibleDialog() || !history.current) return;
    const pending = new Set<string>(); let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { const id = (entry.target as HTMLElement).dataset.messageid; if (!id) continue; if (entry.isIntersecting && entry.intersectionRect.height > 8) pending.add(id); else pending.delete(id); }
      clearTimeout(timer); timer = setTimeout(() => { if (pending.size) void readVisibleMessages(cid, [...pending]).catch(() => {}); pending.clear(); }, 120);
    }, { root: history.current, rootMargin: '-8px 0px', threshold: 0 });
    for (const element of history.current.querySelectorAll<HTMLElement>('[data-messageid]')) { const message = messages.find(item => item.id === element.dataset.messageid); if (message && message.senderId !== me.id && !message.readAt) observer.observe(element); }
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [cid, state.panelOpen, messages, visibility, me.id]);
  const run = async (action: () => Promise<unknown>) => { setError(''); setBusy(true); try { await action(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const send = async () => { if (!cid || !draft.trim()) return; const content = draft; setDrafts(value => ({ ...value, [cid]: '' })); await run(() => sendDirectMessage(cid, content)); };
  const older = async () => { if (!cid || !history.current) return; const height = history.current.scrollHeight; await run(() => loadMessages(cid, true)); requestAnimationFrame(() => { if (history.current) history.current.scrollTop += history.current.scrollHeight - height; }); };
  const videoCall = async () => { if (!conversation) return; const peer = conversation.peerId; if (creatingCall.current.peer !== peer) creatingCall.current = { peer, id: crypto.randomUUID() }; await run(async () => { const name = state.contacts.find(person => person.id === peer)?.name ?? 'коллега'; await createMeeting(`Звонок: ${me.name.split(' ')[0]} и ${name.split(' ')[0]}`, true, peer, creatingCall.current.id); creatingCall.current = { peer: '', id: '' }; }); };
  if (!state.panelOpen) return null;
  const contacts = state.contacts.filter(person => person.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')));
  const showContacts = newDialog || !state.conversations.length;
  return <section ref={panel} tabIndex={-1} id="comm-message-panel" className={`comm-module comm-panel ${route.parts[0] === 'messages' ? 'comm-panel-route' : ''}`} role="dialog" aria-label="Личные сообщения">
    <header className="comm-panel-header">{cid && <Button iconOnly icon={ArrowLeft} variant="ghost" size="sm" aria-label="К списку переписок" onClick={() => { setNewDialog(false); void openConversationList(); }} />}<div className="grow">{cid && conversation ? <><b><PersonName id={conversation.peerId} /></b><small>{Date.parse(conversation.typingUntil ?? '') > now + state.clockOffset + 1000 ? 'Печатает…' : Date.parse(conversation.peerOpenUntil ?? '') > now + state.clockOffset + 1000 && state.connected ? 'Сейчас в диалоге' : 'Личная переписка'}</small></> : <><b>Сообщения</b><small>Личное общение с командой</small></>}</div>{cid && <Button iconOnly icon={Video} variant="ghost" size="sm" aria-label="Видеозвонок собеседнику" disabled={busy || !state.videoReady} onClick={() => void videoCall()} />}{!cid && <Button iconOnly icon={Plus} variant="ghost" size="sm" aria-label="Новая переписка" onClick={() => setNewDialog(value => !value)} />}<Button iconOnly icon={X} variant="ghost" size="sm" aria-label="Закрыть сообщения" onClick={() => setMessagePanel(false)} /></header>
    {DEMO_MODE ? <div className="comm-empty"><p>Личные сообщения доступны после входа в рабочую систему.</p></div> : <>
      {(error || state.error) && <div className="comm-panel-error" role="alert">{error || state.error}<Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void run(() => cid ? loadMessages(cid) : loadCommunications())}>Повторить</Button></div>}
      {!state.connected && state.ready && <div className="comm-connection-status" role="status">Восстанавливаю обновления. Переписка хранится на сервере.</div>}
      {state.loading && !state.ready && <div className="comm-empty" role="status">Загружаю сообщения…</div>}
      {!cid ? <><label className="comm-search"><Search size={16} /><input className="input" value={search} onChange={event => setSearch(event.target.value)} aria-label="Поиск собеседника" placeholder="Найти сотрудника" /></label><div className="comm-dialog-list">{showContacts || search ? <><div className="comm-list-caption">{showContacts ? 'Начать переписку' : 'Сотрудники'}</div>{!contacts.length && <p className="comm-empty">{search ? 'Никого не нашли по этому имени.' : 'Пока нет доступных собеседников.'}</p>}{contacts.map(person => <button type="button" className="comm-dialog" key={person.id} disabled={busy} onClick={() => void run(() => startConversation(person.id))}><PersonAvatar id={person.id} size={42} /><span className="grow"><b>{person.name}</b><small>{person.position || 'Команда'}</small></span><MessageCircle size={16} /></button>)}</> : state.conversations.map(item => <button type="button" className="comm-dialog" key={item.id} onClick={() => void run(() => openConversation(item.id))}><PersonAvatar id={item.peerId} size={42} /><span className="grow"><b><PersonName id={item.peerId} /></b><small>{item.lastMessage?.meetingId ? 'Видеовстреча' : item.lastMessage?.text || 'Начните разговор'}</small></span><span className="comm-dialog-meta">{item.lastMessage && <time>{time(item.lastMessage.createdAt)}</time>}{item.unread > 0 && <span className="comm-unread">{item.unread}</span>}</span></button>)}</div></> : <>
        <div className="comm-message-history" ref={history} onScroll={() => { if (history.current) nearBottom.current = history.current.scrollHeight - history.current.scrollTop - history.current.clientHeight < 80; }}>
          {state.hasOlder[cid] && <Button variant="ghost" size="sm" disabled={state.threadLoading} onClick={() => void older()}>Загрузить предыдущие сообщения</Button>}
          {state.threadLoading && !messages.length && <p role="status" className="muted">Загружаю переписку…</p>}
          {!state.threadLoading && !messages.length && <div className="comm-empty"><MessageCircle size={28} /><p>Здесь начнётся ваш разговор.</p></div>}
          {messages.map(message => <article data-messageid={message.id} key={message.id} className={`comm-message ${message.senderId === me.id ? 'comm-mine' : ''} ${message.sendState === 'error' ? 'comm-failed' : ''}`}>{message.meetingId ? <MeetingCard message={message} /> : <p>{message.text}</p>}<footer><time dateTime={message.createdAt}>{time(message.createdAt)}</time>{message.senderId === me.id && <DeliveryState message={message} />}{message.sendState === 'error' && <button type="button" onClick={() => void run(() => sendDirectMessage(cid, message.text, message.id))}>Повторить отправку</button>}</footer></article>)}
        </div><form className="comm-compose" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="comm-direct-text">Личное сообщение</label><textarea id="comm-direct-text" className="input" rows={2} maxLength={4000} value={draft} placeholder="Написать сообщение" onChange={event => { const value = event.target.value; setDrafts(items => ({ ...items, [cid]: value })); if (Date.now() - typingSent.current > 2000 && visibleDialog()) { typingSent.current = Date.now(); void signalDialog(cid, true, !!value); } }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><Button type="submit" variant="primary" iconOnly icon={Send} aria-label="Отправить сообщение" disabled={!draft.trim() || busy} /></form>
      </>}
    </>}
  </section>;
}
async function openConversationList() { selectConversation(null); }
export function CommunicationsRoot() {
  const me = useMe(); const app = useAppState(); const state = useCommunications(); const route = useRoute(); const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => { if (!DEMO_MODE && me.active !== false && !me.pending) initializeCommunications(me.id); return resetCommunications; }, [me.id, me.active, me.pending]);
  useEffect(() => { if (route.parts[0] === 'messages') { if (route.parts[1] && state.userId) void openConversation(route.parts[1]).catch(error => toast(error.message, 'error')); else setMessagePanel(true); } }, [route.parts.join('/'), state.userId]);
  useEffect(() => { if (route.parts[0] === 'meetings' && route.parts[2] === 'minutes' && state.userId) openMeetingMinutes(route.parts[1]); }, [route.parts.join('/'), state.userId]);
  const invitations = app.ui.notify.meeting === false ? [] : state.invitations.filter(invitation => invitation.userId === me.id && invitation.status === 'pending' && Date.parse(invitation.expiresAt) > Date.now() + state.clockOffset && !dismissed.includes(invitation.id + invitation.updatedAt) && state.call?.meeting.id !== invitation.meetingId).slice(0, 2);
  return <><MessagePanel />{invitations.length > 0 && <div className="comm-incoming" aria-live="polite">{invitations.map(invitation => <section className="comm-module comm-incoming-card" key={invitation.id}><header><Video size={20} /><b className="grow">Приглашение во встречу</b><Button iconOnly size="sm" icon={X} variant="ghost" aria-label="Скрыть приглашение" onClick={() => setDismissed(value => [...value, invitation.id + invitation.updatedAt])} /></header><p><PersonName id={invitation.inviterId} /> приглашает: <b>{state.meetings.find(meeting => meeting.id === invitation.meetingId)?.title ?? 'Видеовстреча'}</b></p><InvitationActions invitation={invitation} /></section>)}</div>}
    <Suspense fallback={<div className="comm-loading" role="status">Открываю видеовстречу…</div>}>{state.prepId && <Preparation key={state.prepId} meetingId={state.prepId} />}{state.call && <ActiveMeeting key={state.call.admission.identity} call={state.call} />}</Suspense>
    <Suspense fallback={<div className="comm-loading" role="status">Открываю документы встречи…</div>}>{state.minutesId && state.userId === me.id && <MeetingMinutes key={state.userId + ':' + state.minutesId} meetingId={state.minutesId} />}</Suspense>
  </>;
}
