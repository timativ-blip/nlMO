import { Check, Copy, Search, UserPlus, Video, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { cancelInvitation, invitePeople, meetingLink, openPreparation, respondInvitation, useCommunications } from '../data/communications';
import type { Invitation, InvitationStatus } from '../data/communication-types';
import { useAppState } from '../data/store';
import { go } from '../lib/router';
import { Avatar, Button, Modal, toast } from './kit';

export const INVITATION_LABEL: Record<InvitationStatus, string> = { pending: 'Отправлено', accepted: 'Приглашение принято', joined: 'Присоединился', declined: 'Отклонено', cancelled: 'Отменено', expired: 'Истекло' };
export function PersonAvatar({ id, size = 34 }: { id: string; size?: number }) { const s = useAppState(); return <Avatar user={s.users.find(user => user.id === id)} size={size} />; }
export function PersonName({ id }: { id: string }) { const s = useAppState(); return <>{s.users.find(user => user.id === id)?.name ?? 'Сотрудник'}</>; }
export async function copyMeetingLink(id: string) {
  try { await navigator.clipboard.writeText(meetingLink(id)); toast('Ссылка скопирована'); }
  catch { toast('Не удалось скопировать. Откройте встречу и скопируйте адрес страницы.', 'error'); }
}
export function InvitationActions({ invitation }: { invitation: Invitation }) {
  const state = useCommunications(); const [busy, setBusy] = useState(false);
  const meeting = state.meetings.find(item => item.id === invitation.meetingId);
  const future = !!meeting?.scheduledAt && Date.parse(meeting.scheduledAt) > Date.now() + state.clockOffset;
  const run = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); } catch (error) { toast((error as Error).message, 'error'); } finally { setBusy(false); } };
  if (['expired', 'cancelled', 'declined', 'joined'].includes(invitation.status)) return <span className="comm-status">{INVITATION_LABEL[invitation.status]}</span>;
  if (invitation.userId === state.userId) return <div className="comm-inline-actions">
    <Button size="sm" variant="primary" icon={Video} disabled={busy || !future && !state.videoReady} onClick={() => void run(async () => { if (invitation.status !== 'accepted') return respondInvitation(invitation.id, 'accepted'); if (future) { go('/meetings/' + invitation.meetingId); return; } return openPreparation(invitation.meetingId); })}>{future ? invitation.status === 'accepted' ? 'Открыть встречу' : 'Принять приглашение' : 'Присоединиться'}</Button>
    <Button size="sm" variant="ghost" icon={X} disabled={busy} onClick={() => void run(() => respondInvitation(invitation.id, 'declined'))}>Отклонить</Button>
  </div>;
  return <div className="comm-inline-actions"><span className="comm-status">{INVITATION_LABEL[invitation.status]}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => cancelInvitation(invitation.id))}>Отменить</Button></div>;
}
export function InvitePeopleDialog({ meetingId, open, onClose }: { meetingId: string; open: boolean; onClose: () => void }) {
  const state = useCommunications(); const [query, setQuery] = useState(''); const [selected, setSelected] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const attempt = useRef({ key: '', id: '' });
  const contacts = state.contacts.filter(person => person.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
  const invite = async () => {
    const key = meetingId + [...selected].sort().join(','); if (attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try { await invitePeople(meetingId, selected, attempt.current.id); setSelected([]); attempt.current = { key: '', id: '' }; toast('Приглашения отправлены'); onClose(); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Пригласить пользователей" width={540} footer={<><Button icon={Copy} onClick={() => void copyMeetingLink(meetingId)}>Скопировать ссылку</Button><Button variant="primary" icon={UserPlus} disabled={!selected.length || busy} onClick={() => void invite()}>{busy ? 'Отправляю…' : `Позвать во встречу${selected.length ? ` · ${selected.length}` : ''}`}</Button></>}>
    <div className="comm-module"><p className="muted">Приглашение придёт внутри сайта. Камера и микрофон включаются только по решению участника.</p>
      <label className="comm-search"><Search size={17} /><input className="input" aria-label="Поиск сотрудников" value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти по имени" /></label>
      {error && <p className="callout error" role="alert">{error}</p>}
      <div className="comm-contact-list">{contacts.length === 0 && <p className="muted">Доступных сотрудников не найдено.</p>}{contacts.map(person => <label className="comm-contact" key={person.id}><input type="checkbox" checked={selected.includes(person.id)} disabled={busy || selected.length >= 20 && !selected.includes(person.id)} onChange={event => setSelected(value => event.target.checked ? [...value, person.id] : value.filter(id => id !== person.id))} /><PersonAvatar id={person.id} /><span className="grow"><b>{person.name}</b><small>{person.position || 'Команда'}</small></span>{selected.includes(person.id) && <Check size={16} />}</label>)}</div>
    </div>
  </Modal>;
}
