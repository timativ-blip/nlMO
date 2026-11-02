import { useSyncExternalStore } from 'react';
import { sb, FUNCTIONS_URL } from '../lib/supabase';
import { withDeadline } from '../lib/deadline';
import { go } from '../lib/router';
import { humanError } from './backend';
import type { ActiveCall, CommunicationIndex, CommunicationState, DirectMessage, Invitation, MediaAdmission, Meeting, MeetingDetail, MeetingMessage } from './communication-types';

const empty = (): CommunicationState => ({ userId: '', loading: false, ready: false, error: '', connected: false, clockOffset: 0, videoReady: false, videoStatusLoaded: false, serverTime: '', contacts: [], conversations: [], unread: 0, meetings: [], invitations: [], panelOpen: false, selected: null, messages: {}, hasOlder: {}, threadLoading: false, details: {}, prepId: null, call: null, callExpanded: true, callNotice: '' });
let state = empty(), generation = 0;
const listeners = new Set<() => void>();
const emit = (patch: Partial<CommunicationState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
export const getCommunications = () => state;
export const useCommunications = () => useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getCommunications);
let channel: ReturnType<NonNullable<typeof sb>['channel']> | null = null;
let poll: ReturnType<typeof setInterval> | undefined, debounce: ReturnType<typeof setTimeout> | undefined;
let loading: Promise<void> | null = null;
let reloadRequested = false;
const pendingInvitations = new Map<string, string>();
const delivered = new Map<string, Set<string>>();
const roomListeners = new Map<string, Set<() => void>>();
export function watchRoomMessages(id: string, listener: () => void) {
  const bucket = roomListeners.get(id) ?? new Set(); bucket.add(listener); roomListeners.set(id, bucket);
  return () => { bucket.delete(listener); if (!bucket.size) roomListeners.delete(id); };
}
let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
export const visibleDialog = () => state.panelOpen && !!state.selected && document.visibilityState === 'visible' && document.hasFocus() && !document.querySelector('.overlay');
const errorText = (error: unknown) => humanError(error instanceof Error ? error.message : 'Не удалось выполнить действие. Повторите попытку.');

export async function communicationsRpc<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!sb || !state.userId) throw new Error('Сообщения доступны после входа в рабочую систему.');
  const current = generation, userId = state.userId;
  const { data: auth } = await withDeadline(() => sb!.auth.getSession(), 12000, 'Не удалось проверить вход.');
  if (generation !== current || state.userId !== userId || auth.session?.user.id !== userId) throw new Error('Учётная запись изменилась. Откройте переписку снова.');
  const { data, error } = await withDeadline(signal => sb!.rpc('communications', { p_action: action, p_body: body }).setHeader('Authorization', `Bearer ${auth.session!.access_token}`).abortSignal(signal), 15000, 'Сообщения не загрузились вовремя. Повторите попытку.');
  if (generation !== current || state.userId !== userId) throw new Error('Учётная запись изменилась. Откройте переписку снова.');
  if (error) throw new Error(/PGRST202|does not exist/.test(error.code + error.message) ? 'Модуль общения ещё не подключён на сервере.' : humanError(error.message));
  return data as T;
}
export async function videoApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!sb || !state.userId) throw new Error('Войдите на сайт.');
  const current = generation, userId = state.userId;
  const { data, error } = await withDeadline(() => sb!.auth.getSession(), 12000, 'Не удалось проверить вход.');
  if (error || !data.session || current !== generation || data.session.user.id !== userId || state.userId !== userId) throw new Error('Учётная запись изменилась. Войдите на сайт заново.');
  return withDeadline(async signal => {
    const response = await fetch(`${FUNCTIONS_URL}/communications`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session!.access_token}`, apikey: import.meta.env.VITE_SUPABASE_KEY }, body: JSON.stringify({ ...body, action }), signal, cache: 'no-store' });
    const result = await response.json();
    if (generation !== current || state.userId !== userId) throw new Error('Учётная запись изменилась. Войдите на сайт заново.');
    if (!response.ok) { const failure = new Error(result.error ?? 'Видеосервис не ответил. Повторите попытку.'); Object.assign(failure, { status: response.status }); throw failure; }
    return result as T;
  }, 25000, 'Видеосервис не ответил вовремя. Повторите попытку.');
}
function mergeMessages(cid: string, messages: DirectMessage[]) {
  const merged = new Map((state.messages[cid] ?? []).map(message => [message.id, message]));
  for (const message of messages) {
    const previous = merged.get(message.id);
    if (previous?.seq && message.sendState) continue;
    merged.set(message.id, { ...message, deliveredAt: message.deliveredAt ?? previous?.deliveredAt, readAt: message.readAt ?? previous?.readAt });
  }
  const rows = [...merged.values()].sort((a, b) => a.seq && b.seq ? BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0 : a.seq ? -1 : b.seq ? 1 : a.createdAt.localeCompare(b.createdAt));
  emit({ messages: { ...state.messages, [cid]: rows } });
}
function acknowledgeDelivered(cid: string, ids: string[]) {
  const bucket = delivered.get(cid) ?? new Set<string>(); ids.forEach(id => bucket.add(id)); delivered.set(cid, bucket);
  if (deliveryTimer) return;
  const current = generation;
  deliveryTimer = setTimeout(() => {
    deliveryTimer = undefined;
    const pending = [...delivered]; delivered.clear();
    if (generation !== current) return;
    for (const [conversationId, ids] of pending) {
      const values = [...ids];
      for (let i = 0; i < values.length; i += 100) void communicationsRpc('receipts', { conversationId, ids: values.slice(i, i + 100), read: false }).catch(() => {});
    }
  }, 150);
}
export async function loadCommunications() {
  if (!sb || !state.userId) return;
  if (loading) { reloadRequested = true; return loading; }
  const current = generation;
  const started = Date.now();
  loading = (async () => {
    try {
      const index = await communicationsRpc<CommunicationIndex>('index');
      if (current !== generation) return;
      const details = { ...state.details };
      for (const meeting of index.meetings) if (details[meeting.id]) {
        const invitations = new Map(details[meeting.id].invitations.map(invitation => [invitation.id, invitation]));
        for (const invitation of index.invitations) if (invitation.meetingId === meeting.id) invitations.set(invitation.id, invitation);
        details[meeting.id] = { ...details[meeting.id], meeting, invitations: [...invitations.values()] };
      }
      emit({ ...index, details, clockOffset: Date.parse(index.serverTime) - (started + Date.now()) / 2, ready: true, loading: false, error: '' });
      for (const conversation of index.conversations) if (conversation.lastMessage?.senderId !== state.userId && conversation.lastMessage?.id && !conversation.lastMessage.deliveredAt) acknowledgeDelivered(conversation.id, [conversation.lastMessage.id]);
    } catch (error) { if (current === generation) emit({ loading: false, error: errorText(error) }); }
    finally { if (current === generation) { loading = null; if (reloadRequested) { reloadRequested = false; void loadCommunications(); } } }
  })();
  return loading;
}
export function initializeCommunications(userId: string) {
  if (!sb || state.userId === userId) return;
  resetCommunications(); emit({ userId, loading: true });
  const current = generation;
  void loadCommunications();
  void videoApi<{ videoReady: boolean }>('status').then(result => { if (current === generation) emit({ videoReady: result.videoReady, videoStatusLoaded: true }); }).catch(() => { if (current === generation) emit({ videoReady: false, videoStatusLoaded: true }); });
  const refresh = () => {
    if (current !== generation) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => { void loadCommunications(); if (state.selected && state.panelOpen) void loadMessages(state.selected).catch(() => {}); if (state.call) void loadMeeting(state.call.meeting.id).catch(() => {}); }, 160);
  };
  channel = sb.channel('kc-communications-' + userId);
  for (const table of ['comm_messages', 'comm_members', 'comm_invitations', 'comm_meetings', 'comm_participants', 'comm_room_messages']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, event => {
      if (current !== generation) return;
      if (table === 'comm_messages') {
        const row = event.new as Record<string, unknown>;
        if (row.id && row.sender_id !== userId && !row.delivered_at) acknowledgeDelivered(row.conversation_id as string, [row.id as string]);
      }
      if (table === 'comm_room_messages') {
        const row = event.new as Record<string, unknown>;
        roomListeners.get(row.meeting_id as string)?.forEach(listener => listener());
      }
      if (table === 'comm_participants' && state.call) {
        const row = event.new as Record<string, unknown>;
        if (row.user_id === userId && row.meeting_id === state.call.meeting.id && (row.state === 'removed' || row.media_identity !== state.call.admission.identity)) finishCall(row.state === 'removed' ? 'Организатор удалил вас из встречи.' : 'Встреча открыта в другом подключении.');
      }
      if (table === 'comm_meetings' && state.call) {
        const row = event.new as Record<string, unknown>;
        if (row.id === state.call.meeting.id && row.ended_at) finishCall('Организатор завершил встречу.');
      }
      refresh();
    });
  }
  channel.subscribe(status => { if (current !== generation) return; emit({ connected: status === 'SUBSCRIBED' }); if (status === 'SUBSCRIBED') refresh(); });
  poll = setInterval(() => { if (current !== generation || document.visibilityState !== 'visible') return; void loadCommunications(); if (state.selected && state.panelOpen) void loadMessages(state.selected).catch(() => {}); }, 12000);
}
export function resetCommunications() {
  ++generation; channel?.unsubscribe(); channel = null; clearInterval(poll); clearTimeout(debounce); clearTimeout(deliveryTimer); deliveryTimer = undefined; delivered.clear(); roomListeners.clear(); pendingInvitations.clear(); loading = null; reloadRequested = false;
  state.call?.tracks.forEach(track => track.stop()); state = empty(); listeners.forEach(fn => fn());
}
export function setMessagePanel(open: boolean) { emit({ panelOpen: open }); }
export function selectConversation(id: string | null) { emit({ selected: id }); }
export async function openConversation(id: string) { emit({ panelOpen: true, selected: id }); await loadMessages(id); }
export async function startConversation(peerId: string) {
  const current = generation;
  const result = await communicationsRpc<{ conversationId: string }>('start', { peerId, requestId: crypto.randomUUID() });
  if (current !== generation) return;
  await loadCommunications(); await openConversation(result.conversationId);
}
export async function loadMessages(cid: string, older = false) {
  const current = generation;
  const oldest = (state.messages[cid] ?? []).find(message => message.seq)?.seq;
  if (cid === state.selected) emit({ threadLoading: true });
  try {
    const messages = await communicationsRpc<DirectMessage[]>('messages', { conversationId: cid, limit: 50, ...(older && oldest ? { before: oldest } : {}) });
    if (current !== generation) return;
    mergeMessages(cid, messages);
    if (older || !oldest || (state.messages[cid] ?? []).filter(message => message.seq).length <= 50)
      emit({ hasOlder: { ...state.hasOlder, [cid]: messages.length === 50 } });
    acknowledgeDelivered(cid, messages.filter(message => message.senderId !== state.userId && !message.deliveredAt).map(message => message.id));
  } finally { if (current === generation && cid === state.selected) emit({ threadLoading: false }); }
}
export async function sendDirectMessage(cid: string, text: string, existingId?: string) {
  const current = generation;
  const id = existingId ?? crypto.randomUUID();
  const message: DirectMessage = { id, conversationId: cid, senderId: state.userId, text: text.trim(), createdAt: new Date().toISOString(), sendState: 'sending' };
  if (!message.text || message.text.length > 4000) throw new Error('Введите сообщение до 4000 символов.');
  mergeMessages(cid, [message]);
  try {
    const saved = await communicationsRpc<DirectMessage>('send', { conversationId: cid, requestId: id, text: message.text });
    if (current !== generation) return;
    mergeMessages(cid, [saved]); await loadCommunications();
  } catch (error) { if (current === generation) mergeMessages(cid, [{ ...message, sendState: 'error' }]); throw error; }
}
export async function readVisibleMessages(cid: string, ids: string[]) {
  if (!visibleDialog() || state.selected !== cid || !ids.length) return;
  const current = generation;
  await communicationsRpc('receipts', { conversationId: cid, ids: ids.slice(0, 100), read: true });
  if (current === generation) { void loadCommunications(); void loadMessages(cid).catch(() => {}); }
}
export const signalDialog = (cid: string, open: boolean, typing = false) => communicationsRpc('activity', { conversationId: cid, open, typing }).catch(() => {});
export async function loadMeeting(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Ссылка встречи недействительна. Попросите организатора прислать новую ссылку.');
  const current = generation;
  const detail = await communicationsRpc<MeetingDetail>('meeting', { meetingId: id });
  if (current === generation) emit({ details: { ...state.details, [id]: detail } });
  return detail;
}
export async function createMeeting(title: string, inviteOnly = false, peerId?: string, requestId: string = crypto.randomUUID(), options: { scheduledAt?: string; notifyAll?: boolean } = {}) {
  const current = generation;
  const result = await videoApi<{ meeting: Meeting; conversationId?: string }>('create', { requestId, title, inviteOnly, ...options, ...(peerId ? { peerId } : {}) });
  if (current !== generation) throw new Error('Учётная запись изменилась.');
  emit({ panelOpen: false, callNotice: '' });
  await loadCommunications();
  go('/meetings/' + result.meeting.id); return result.meeting;
}
export async function invitePeople(mid: string, userIds: string[], requestId: string = crypto.randomUUID()) {
  await communicationsRpc('invite', { meetingId: mid, userIds, requestId }); await loadMeeting(mid); await loadCommunications();
}
export async function respondInvitation(invitationId: string, response: 'accepted' | 'declined') {
  const current = generation;
  const key = invitationId + ':' + response, requestId = pendingInvitations.get(key) ?? crypto.randomUUID(); pendingInvitations.set(key, requestId);
  const invitation = await videoApi<Invitation>('respond', { invitationId, response, requestId }); pendingInvitations.delete(key);
  await loadCommunications();
  if (current === generation && response === 'accepted') { go('/meetings/' + invitation.meetingId); const meeting = state.meetings.find(item => item.id === invitation.meetingId); if (!meeting?.scheduledAt || Date.parse(meeting.scheduledAt) <= Date.now() + state.clockOffset) await openPreparation(invitation.meetingId); }
}
export async function cancelInvitation(invitationId: string) { const key = invitationId + ':cancel', requestId = pendingInvitations.get(key) ?? crypto.randomUUID(); pendingInvitations.set(key, requestId); await videoApi('cancel_invite', { invitationId, requestId }); pendingInvitations.delete(key); await loadCommunications(); }
export async function openPreparation(id: string) {
  if (state.call && state.call.meeting.id !== id) throw new Error('Сначала выйдите из текущей встречи.');
  if (state.call) { emit({ callExpanded: true }); return; }
  const current = generation;
  await loadMeeting(id);
  if (current !== generation) throw new Error('Учётная запись изменилась.');
  const activeCall = getCommunications().call;
  if (activeCall) { if (activeCall.meeting.id !== id) throw new Error('Сначала выйдите из текущей встречи.'); emit({ callExpanded: true }); return; }
  emit({ prepId: id, panelOpen: false, callNotice: '' });
}
export function closePreparation() { emit({ prepId: null }); }
export function activateCall(call: ActiveCall) { emit({ call, prepId: null, panelOpen: false, callExpanded: true, callNotice: '' }); }
export function finishCall(notice = 'Вы вышли из встречи.') { emit({ call: null, callNotice: notice }); }
export function expandCall(expanded: boolean) { emit({ callExpanded: expanded }); }
export async function moderateMeeting(mid: string, operation: 'end' | 'lock' | 'unlock' | 'remove' | 'mute', userId?: string, requestId: string = crypto.randomUUID()) {
  await videoApi('moderate', { meetingId: mid, operation, requestId, ...(userId ? { userId } : {}) }); await loadMeeting(mid); await loadCommunications();
  if (operation === 'end' && state.call?.meeting.id === mid) finishCall('Вы завершили встречу для всех.');
}
export async function announceMeeting(mid: string, requestId: string) {
  await videoApi('announce', { meetingId: mid, requestId }); await loadMeeting(mid); await loadCommunications();
}
export async function rescheduleMeeting(mid: string, scheduledAt: string, requestId: string) {
  await videoApi('schedule', { meetingId: mid, scheduledAt, requestId }); await loadMeeting(mid); await loadCommunications();
}
export const loadRoomMessages = (mid: string) => communicationsRpc<MeetingMessage[]>('room_messages', { meetingId: mid });
export const sendRoomMessage = (mid: string, text: string, requestId: string) => communicationsRpc('room_send', { meetingId: mid, text, requestId });
export function meetingLink(id: string) { const url = new URL(location.href); url.search = ''; url.hash = '/meetings/' + id; return url.href; }
