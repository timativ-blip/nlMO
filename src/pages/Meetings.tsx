import { ArrowRight, CalendarClock, Copy, FileText, Lock, Megaphone, Plus, RefreshCw, Square, UserPlus, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Meeting } from '../data/communication-types';
import type { Route } from '../lib/router';
import { go } from '../lib/router';
import { meetingInput, meetingInstant, meetingLabel, meetingPhase, meetingWhen } from '../lib/meeting-time';
import { announceMeeting, createMeeting, loadCommunications, loadMeeting, moderateMeeting, openMeetingMinutes, openPreparation, rescheduleMeeting, useCommunications } from '../data/communications';
import { DEMO_MODE } from '../data/store';
import { Button, Modal, toast } from '../ui/kit';
import { copyMeetingLink, InvitationActions, InvitePeopleDialog, PersonName } from '../ui/MeetingInvites';
import '../communications.css';

const nextTime = () => meetingInput(new Date(Math.ceil((Date.now() + 3600000) / 900000) * 900000).toISOString());
export default function MeetingsPage({ route }: { route: Route }) {
  const state = useCommunications(); const id = route.parts[1]; const detail = id ? state.details[id] : undefined;
  const [createOpen, setCreateOpen] = useState(false), [title, setTitle] = useState(''), [inviteOnly, setInviteOnly] = useState(false), [notifyAll, setNotifyAll] = useState(true);
  const [scheduled, setScheduled] = useState(false), [at, setAt] = useState(nextTime), [editing, setEditing] = useState<Meeting | null>(null), [ending, setEnding] = useState<Meeting | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [modalError, setModalError] = useState(''), [inviting, setInviting] = useState<string | null>(null), [now, setNow] = useState(Date.now());
  const attempt = useRef({ key: '', id: '' });
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { setError(''); if (id && state.userId) void loadMeeting(id).catch(error => setError((error as Error).message)); }, [id, state.userId]);
  const serverNow = now + state.clockOffset;
  const phase = detail ? meetingPhase(detail.meeting, serverNow) : undefined;
  const showCreate = (future: boolean) => { setScheduled(future); setAt(nextTime()); setModalError(''); setCreateOpen(true); };
  const save = async () => {
    setBusy(true); setModalError('');
    try {
      const scheduledAt = scheduled || editing ? meetingInstant(at) : undefined;
      if (scheduledAt && Date.parse(scheduledAt) <= Date.now() + state.clockOffset) throw new Error('Выберите время в будущем.');
      const key = JSON.stringify({ title: title.trim(), inviteOnly, notifyAll, scheduledAt, editing: editing?.id });
      if (attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() };
      if (editing) { await rescheduleMeeting(editing.id, scheduledAt!, attempt.current.id); toast('Время изменено. Участники получат уведомление.'); setEditing(null); }
      else { await createMeeting(title.trim(), inviteOnly, undefined, attempt.current.id, { ...(scheduledAt ? { scheduledAt } : {}), notifyAll: notifyAll && !inviteOnly }); setCreateOpen(false); setTitle(''); }
      attempt.current = { key: '', id: '' };
    } catch (error) { setModalError((error as Error).message); } finally { setBusy(false); }
  };
  const prepare = async (mid: string) => { try { await openPreparation(mid); } catch (error) { toast((error as Error).message, 'error'); } };
  const end = async () => {
    if (!ending) return; setBusy(true); setModalError('');
    const key = 'end:' + ending.id; if (attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    try { await moderateMeeting(ending.id, 'end', undefined, attempt.current.id); setEnding(null); attempt.current = { key: '', id: '' }; toast('Встреча закрыта. Участники получат уведомление.'); }
    catch (error) { setModalError((error as Error).message); } finally { setBusy(false); }
  };
  const announce = async () => {
    if (!id) return; setBusy(true); const key = 'announce:' + id; if (attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    try { await announceMeeting(id, attempt.current.id); attempt.current = { key: '', id: '' }; toast('Приглашение отправлено всей команде.'); } catch (error) { toast((error as Error).message, 'error'); } finally { setBusy(false); }
  };
  const upcoming = state.meetings.filter(meeting => meetingPhase(meeting, serverNow) === 'scheduled').sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
  const live = state.meetings.filter(meeting => meetingPhase(meeting, serverNow) === 'live');
  const past = state.meetings.filter(meeting => ['ended', 'cancelled'].includes(meetingPhase(meeting, serverNow)));
  const cards = (meetings: Meeting[]) => <div className="comm-meeting-list">{meetings.map(meeting => <button type="button" className="card comm-meeting-card" key={meeting.id} onClick={() => go('/meetings/' + meeting.id)}>
    <span className="comm-meeting-icon">{meetingPhase(meeting, serverNow) === 'scheduled' ? <CalendarClock size={23} /> : <Video size={23} />}</span>
    <span className="comm-meeting-summary"><b>{meeting.title}</b>{meeting.scheduledAt && <span className="comm-meeting-date"><CalendarClock size={14} />{meetingWhen(meeting.scheduledAt)}</span>}<small>Организатор: <PersonName id={meeting.ownerId} /></small></span>
    <span className="comm-status">{meeting.locked && meetingPhase(meeting, serverNow) === 'live' && <Lock size={13} />}{meetingLabel(meeting, serverNow)}</span><ArrowRight size={18} />
  </button>)}</div>;
  const cancelling = ending && meetingPhase(ending, serverNow) === 'scheduled';
  return <div className="comm-module comm-meetings">
    <div className="page-head comm-meetings-head"><div className="grow"><h1>Видеовстречи</h1><p className="muted">Команда рядом — с любого устройства.</p></div><div className="comm-inline-actions"><Button icon={CalendarClock} disabled={DEMO_MODE || !state.ready} onClick={() => showCreate(true)}>Запланировать</Button><Button variant="primary" icon={Plus} disabled={DEMO_MODE || !state.videoReady} onClick={() => showCreate(false)}>Создать встречу</Button></div></div>
    {DEMO_MODE ? <div className="callout info">Видеовстречи и личные сообщения доступны после входа в рабочую систему.</div> : !state.videoReady && <div className="comm-availability" role="status"><Video size={24} /><div><b>{state.videoStatusLoaded ? 'Видеосвязь ещё не подключена' : 'Проверяю доступность видеосвязи…'}</b><p>Можно переписываться и планировать встречи. Для подключения к звонку нужна доступная видеосвязь.</p></div></div>}
    {state.error && <div className="callout error" role="alert">{state.error}<Button size="sm" icon={RefreshCw} onClick={() => void loadCommunications()}>Повторить</Button></div>}
    {error && <p className="callout error" role="alert">{error}</p>}
    {state.callNotice && <p className="callout info comm-call-notice" role="status">{state.callNotice}</p>}
    {id && detail && <section className="card comm-meeting-detail">
      <div className="comm-meeting-detail-head"><div className="grow"><span className="eyebrow">Встреча</span><h2>{detail.meeting.title}</h2><p className="muted">Организатор: <PersonName id={detail.meeting.ownerId} /></p></div><span className={`comm-status ${phase === 'live' ? 'active' : ''}`}>{meetingLabel(detail.meeting, serverNow)}</span></div>
      <div className="comm-meeting-facts">{detail.meeting.scheduledAt && <p><CalendarClock size={17} /><span>{meetingWhen(detail.meeting.scheduledAt)}</span></p>}<p>До 8 часов{detail.meeting.scheduledAt ? ' с назначенного начала' : ' с момента создания'}. Закрытие: {meetingWhen(detail.meeting.expiresAt)}.</p></div>
      <div className="comm-inline-actions">
        <Button variant="primary" icon={Video} disabled={!state.videoReady || phase !== 'live'} onClick={() => void prepare(id)}>{state.call?.meeting.id === id ? 'Вернуться во встречу' : 'Подготовиться к подключению'}</Button>
        <Button icon={Copy} onClick={() => void copyMeetingLink(id)}>Скопировать ссылку</Button>
        <Button icon={FileText} onClick={() => openMeetingMinutes(id)}>Повестка и протокол</Button>
        {detail.meeting.active && (detail.meeting.ownerId === state.userId || detail.participants.some(person => person.userId === state.userId && person.state === 'joined')) && <Button icon={UserPlus} disabled={detail.meeting.locked} onClick={() => setInviting(id)}>Пригласить пользователей</Button>}
        {detail.meeting.active && detail.meeting.ownerId === state.userId && <>
          {!detail.meeting.inviteOnly && !detail.meeting.notifyAll && <Button icon={Megaphone} disabled={busy} onClick={() => void announce()}>Уведомить команду</Button>}
          {phase === 'scheduled' && <Button icon={CalendarClock} onClick={() => { setAt(meetingInput(detail.meeting.scheduledAt!)); setModalError(''); setEditing(detail.meeting); }}>Изменить время</Button>}
          <Button variant="danger" icon={Square} onClick={() => { setModalError(''); setEnding(detail.meeting); }}>{phase === 'scheduled' ? 'Отменить встречу' : 'Завершить встречу'}</Button>
        </>}
      </div>
      {phase === 'scheduled' && <p className="comm-schedule-hint" role="status">Подключение откроется в назначенное время. Уведомление о начале придёт автоматически.</p>}
      <p className="small muted">{detail.meeting.inviteOnly ? 'Вход по личному приглашению.' : detail.meeting.notifyAll ? 'Встреча для всей команды.' : 'Вход по ссылке для сотрудников сайта.'} Камера и микрофон на экране подготовки выключены.</p>
      {detail.invitations.length > 0 && <div className="comm-invitation-list">{detail.invitations.map(invitation => <div className="comm-invitation-row" key={invitation.id}><span className="grow"><PersonName id={invitation.userId} /></span><InvitationActions invitation={invitation} /></div>)}</div>}
    </section>}
    {state.invitations.some(invitation => invitation.userId === state.userId && ['pending', 'accepted'].includes(invitation.status)) && <section className="comm-invitation-section"><h2>Вас приглашают</h2>{state.invitations.filter(invitation => invitation.userId === state.userId && ['pending', 'accepted'].includes(invitation.status)).map(invitation => { const meeting = state.meetings.find(item => item.id === invitation.meetingId); return <div className="card comm-invitation-row" key={invitation.id}><div className="grow"><b>{meeting?.title ?? 'Видеовстреча'}</b>{meeting?.scheduledAt && <p>{meetingWhen(meeting.scheduledAt)}</p>}<p className="muted"><PersonName id={invitation.inviterId} /></p></div><InvitationActions invitation={invitation} /></div>; })}</section>}
    {state.loading && !state.ready && <p className="muted" role="status">Загружаю встречи…</p>}
    {state.ready && !state.meetings.length && <section><h2>Мои встречи</h2><div className="card comm-empty"><Video size={34} /><h3>Пока нет встреч</h3><p>Создайте встречу или запланируйте её на удобное время.</p></div></section>}
    {upcoming.length > 0 && <section><h2>Предстоящие</h2>{cards(upcoming)}</section>}
    {live.length > 0 && <section><h2>Сейчас</h2>{cards(live)}</section>}
    {past.length > 0 && <section><h2>Завершённые и отменённые</h2>{cards(past)}</section>}
    <Modal open={createOpen || !!editing} onClose={() => { if (!busy) { setCreateOpen(false); setEditing(null); } }} title={editing ? 'Изменить время встречи' : 'Новая видеовстреча'} footer={<><Button disabled={busy} onClick={() => { setCreateOpen(false); setEditing(null); }}>Отмена</Button><Button variant="primary" icon={scheduled || editing ? CalendarClock : Video} disabled={busy || !editing && title.trim().length < 3} onClick={() => void save()}>{busy ? 'Сохраняю…' : editing ? 'Сохранить время' : scheduled ? 'Запланировать встречу' : 'Создать встречу'}</Button></>}>
      <div className="comm-module comm-meeting-form">
        {!editing && <><label className="field">Название<input className="input" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} placeholder="Например, планёрка команды" /></label><label className="comm-check"><input type="checkbox" checked={scheduled} onChange={event => setScheduled(event.target.checked)} />На определённую дату и время</label></>}
        {(scheduled || editing) && <label className="field">Начало встречи · МСК<input type="datetime-local" className="input" aria-label="Дата и время встречи по Москве" value={at} onChange={event => setAt(event.target.value)} required /></label>}
        {!editing && <><label className="comm-check"><input type="checkbox" checked={inviteOnly} onChange={event => { setInviteOnly(event.target.checked); if (event.target.checked) setNotifyAll(false); }} />Только по личным приглашениям</label><label className="comm-check"><input type="checkbox" checked={notifyAll} disabled={inviteOnly} onChange={event => setNotifyAll(event.target.checked)} />Уведомить всю команду</label></>}
        <p className="small muted">{editing ? 'Ссылка сохранится. Участники получат новое время встречи.' : notifyAll && !inviteOnly ? 'Все активные сотрудники увидят встречу и получат уведомление на сайте и в подключённом Telegram.' : 'После создания можно пригласить нужных сотрудников.'}</p>
        <p className="small muted">Встреча доступна до 8 часов с {scheduled || editing ? 'назначенного начала' : 'момента создания'}. Организатор может завершить её раньше.</p>
        {modalError && <p className="callout error" role="alert">{modalError}</p>}
      </div>
    </Modal>
    <Modal open={!!ending} onClose={() => { if (!busy) setEnding(null); }} title={cancelling ? 'Отменить встречу?' : 'Завершить встречу для всех?'} footer={<><Button disabled={busy} onClick={() => setEnding(null)}>Вернуться</Button><Button variant="danger" disabled={busy} onClick={() => void end()}>{cancelling ? 'Да, отменить встречу' : 'Завершить для всех'}</Button></>}>
      <div className="comm-module"><p>{cancelling ? 'Приглашения станут неактивными, а участники получат уведомление об отмене.' : 'Все участники отключатся. Войти в эту встречу снова будет нельзя.'}</p>{ending && <p><b>{ending.title}</b></p>}{modalError && <p className="callout error" role="alert">{modalError}</p>}</div>
    </Modal>
    {inviting && <InvitePeopleDialog meetingId={inviting} open onClose={() => setInviting(null)} />}
  </div>;
}
