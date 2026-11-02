import { ArrowRight, Copy, Lock, Plus, RefreshCw, UserPlus, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Route } from '../lib/router';
import { go } from '../lib/router';
import { createMeeting, loadCommunications, loadMeeting, openPreparation, useCommunications } from '../data/communications';
import { DEMO_MODE } from '../data/store';
import { Button, Modal, toast } from '../ui/kit';
import { copyMeetingLink, InvitationActions, InvitePeopleDialog, PersonName } from '../ui/MeetingInvites';
import '../communications.css';

export default function MeetingsPage({ route }: { route: Route }) {
  const state = useCommunications(); const id = route.parts[1]; const detail = id ? state.details[id] : undefined;
  const [createOpen, setCreateOpen] = useState(false), [title, setTitle] = useState(''), [inviteOnly, setInviteOnly] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [inviting, setInviting] = useState<string | null>(null);
  const attempt = useRef({ key: '', id: '' });
  useEffect(() => { setError(''); if (id && state.userId) void loadMeeting(id).catch(error => setError((error as Error).message)); }, [id, state.userId]);
  const create = async () => {
    const key = title.trim() + ':' + inviteOnly; if (attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await createMeeting(title.trim(), inviteOnly, undefined, attempt.current.id); setCreateOpen(false); setTitle(''); attempt.current = { key: '', id: '' }; }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const prepare = async (mid: string) => { try { await openPreparation(mid); } catch (error) { toast((error as Error).message, 'error'); } };
  return <div className="comm-module comm-meetings">
    <div className="page-head"><div><h1>Видеовстречи</h1><p className="muted">Команда рядом — с любого устройства.</p></div><Button variant="primary" icon={Plus} disabled={DEMO_MODE || !state.videoReady} onClick={() => setCreateOpen(true)}>Создать встречу</Button></div>
    {DEMO_MODE ? <div className="callout info">Видеовстречи и личные сообщения доступны после входа в рабочую систему.</div> : !state.videoReady && <div className="comm-availability" role="status"><Video size={24} /><div><b>{state.videoStatusLoaded ? 'Видеосвязь ещё не подключена' : 'Проверяю доступность видеосвязи…'}</b><p>Личные сообщения доступны. Когда видеосвязь будет подключена, здесь можно будет создавать встречи и приглашать команду.</p></div></div>}
    {state.error && <div className="callout error" role="alert">{state.error}<Button size="sm" icon={RefreshCw} onClick={() => void loadCommunications()}>Повторить</Button></div>}
    {error && <p className="callout error" role="alert">{error}</p>}
    {state.callNotice && <p className="callout info" role="status">{state.callNotice}</p>}
    {id && detail && <section className="card comm-meeting-detail">
      <div className="row wrap"><div className="grow"><span className="eyebrow">Встреча</span><h2>{detail.meeting.title}</h2><p className="muted">Организатор: <PersonName id={detail.meeting.ownerId} /></p></div><span className={`comm-status ${detail.meeting.active ? 'active' : ''}`}>{detail.meeting.active ? detail.meeting.locked ? 'Вход закрыт' : 'Активна' : 'Завершена'}</span></div>
      <div className="comm-inline-actions"><Button variant="primary" icon={Video} disabled={!state.videoReady || !detail.meeting.active} onClick={() => void prepare(id)}>{state.call?.meeting.id === id ? 'Вернуться во встречу' : 'Подготовиться к подключению'}</Button><Button icon={Copy} onClick={() => void copyMeetingLink(id)}>Скопировать ссылку</Button>{detail.meeting.active && (detail.meeting.ownerId === state.userId || detail.participants.some(person => person.userId === state.userId && person.state === 'joined')) && <Button icon={UserPlus} disabled={detail.meeting.locked} onClick={() => setInviting(id)}>Пригласить пользователей</Button>}</div>
      <p className="small muted">{detail.meeting.inviteOnly ? 'Вход по приглашению для сотрудников сайта.' : 'Вход по ссылке для сотрудников сайта.'} Камера и микрофон на экране подготовки выключены.</p>
      {detail.invitations.length > 0 && <div className="comm-invitation-list">{detail.invitations.map(invitation => <div className="comm-invitation-row" key={invitation.id}><span className="grow"><PersonName id={invitation.userId} /></span><InvitationActions invitation={invitation} /></div>)}</div>}
    </section>}
    {state.invitations.filter(invitation => invitation.userId === state.userId && ['pending', 'accepted'].includes(invitation.status)).length > 0 && <section className="comm-invitation-section"><h2>Вас приглашают</h2>{state.invitations.filter(invitation => invitation.userId === state.userId && ['pending', 'accepted'].includes(invitation.status)).map(invitation => <div className="card comm-invitation-row" key={invitation.id}><div className="grow"><b>{state.meetings.find(meeting => meeting.id === invitation.meetingId)?.title ?? 'Видеовстреча'}</b><p className="muted"><PersonName id={invitation.inviterId} /></p></div><InvitationActions invitation={invitation} /></div>)}</section>}
    <section><h2>Мои встречи</h2>{state.loading && !state.ready && <p className="muted" role="status">Загружаю встречи…</p>}{state.ready && state.meetings.length === 0 && <div className="card comm-empty"><Video size={34} /><h3>Пока нет встреч</h3><p>Создайте встречу или откройте приглашение от коллеги.</p></div>}<div className="comm-meeting-list">{state.meetings.map(meeting => <button className="card comm-meeting-card" key={meeting.id} onClick={() => go('/meetings/' + meeting.id)}><span className="comm-meeting-icon"><Video size={23} /></span><span className="grow"><b>{meeting.title}</b><small>Организатор: <PersonName id={meeting.ownerId} /></small></span><span className="comm-status">{!meeting.active ? 'Завершена' : meeting.locked ? <><Lock size={13} />Вход закрыт</> : 'Активна'}</span><ArrowRight size={18} /></button>)}</div></section>
    <Modal open={createOpen} onClose={() => { if (!busy) setCreateOpen(false); }} title="Новая видеовстреча" footer={<><Button disabled={busy} onClick={() => setCreateOpen(false)}>Отмена</Button><Button variant="primary" icon={Video} disabled={busy || title.trim().length < 3} onClick={() => void create()}>{busy ? 'Создаю…' : 'Создать встречу'}</Button></>}><div className="comm-module"><label className="field">Название<input className="input" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} placeholder="Например, планёрка команды" /></label><label className="comm-check"><input type="checkbox" checked={inviteOnly} onChange={event => setInviteOnly(event.target.checked)} />Только по личным приглашениям</label><p className="small muted">Организатор сможет закрыть вход, отключить микрофон участника и завершить встречу для всех.</p>{error && <p className="callout error" role="alert">{error}</p>}</div></Modal>
    {inviting && <InvitePeopleDialog meetingId={inviting} open onClose={() => setInviting(null)} />}
  </div>;
}
