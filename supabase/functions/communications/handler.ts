import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'npm:livekit-server-sdk@2.19.2';

export interface MediaConfig { url: string; apiKey: string; apiSecret: string }
interface Dependencies {
  admin: SupabaseClient;
  userClient: (jwt: string) => SupabaseClient;
  media?: MediaConfig;
  appOrigin: string;
  allowLocalMedia?: boolean;
  hookSecret: () => Promise<string>;
  now?: () => number;
}
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0; for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
export function mediaReady(media: MediaConfig | undefined, allowLocal = false) {
  if (!media?.apiKey || !media.apiSecret) return false;
  try {
    const url = new URL(media.url);
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
      (url.protocol === 'wss:' && url.hostname.endsWith('.livekit.cloud') || allowLocal && url.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
  } catch { return false; }
}
type Admission = { meetingId: string; room: string; identity: string; userId: string; name: string; ownerId: string };
type Control = { id: string; meetingId: string; room: string; action: string; identities: string[]; applied: boolean };

export async function admissionToken(media: MediaConfig, admitted: Admission) {
  const grant = new AccessToken(media.apiKey, media.apiSecret, { ttl: 90, identity: admitted.identity, name: admitted.name, metadata: JSON.stringify({ uid: admitted.userId }) });
  grant.addGrant({ room: admitted.room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false, canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO], canUpdateOwnMetadata: false });
  return grant.toJwt();
}

export function createCommunicationsHandler(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  const ready = mediaReady(deps.media, deps.allowLocalMedia);
  const media = ready ? deps.media! : undefined;
  const rooms = media ? new RoomServiceClient(media.url, media.apiKey, media.apiSecret, { requestTimeout: 8, failover: false }) : null;
  const receiver = media ? new WebhookReceiver(media.apiKey, media.apiSecret) : null;
  async function rpc<T>(client: SupabaseClient, name: string, action: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const { data, error } = await client.rpc(name, { p_action: action, p_body: body }).abortSignal(controller.signal);
      if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.code === '22P02' ? 'Некорректные параметры запроса.' : error.message);
      return data as T;
    } finally { clearTimeout(timer); }
  }
  const internal = <T>(action: string, body: Record<string, unknown>) => rpc<T>(deps.admin, 'communications_media', action, body);
  const missing = () => { if (!rooms || !media) throw new HttpError(503, 'Видеосвязь ещё не подключена. Личные сообщения продолжают работать.'); };
  async function remove(room: string, identity: string) {
    try { await rooms!.removeParticipant(room, identity, { revokeTokenTs: BigInt(Math.floor(now() / 1000) + 1) }); }
    catch (error) { if ((error as { code?: string }).code !== 'not_found') throw error; }
    await internal('revoked', { meetingId: room.slice(3), identity });
  }
  async function enforce(userId: string, controlId: string) {
    const op = await internal<Control>('control', { userId, controlId });
    if (op.applied) return;
    if (op.action === 'mute') {
      for (const identity of op.identities) {
        try {
          const person = await rooms!.getParticipant(op.room, identity);
          for (const track of person.tracks) if (track.source === TrackSource.MICROPHONE && !track.muted)
            await rooms!.mutePublishedTrack(op.room, identity, track.sid, true);
        } catch (error) { if ((error as { code?: string }).code !== 'not_found') throw error; }
      }
    } else {
      for (let i = 0; i < op.identities.length; i += 6)
        await Promise.all(op.identities.slice(i, i + 6).map(identity => remove(op.room, identity)));
      if (op.action === 'end') {
        try { await rooms!.deleteRoom(op.room); } catch (error) { if ((error as { code?: string }).code !== 'not_found') throw error; }
      }
    }
    await internal('control_done', { userId, controlId });
  }
  async function mediaEvent(event: string, room: string, identity: string, sid: string, eventId: string, at: number) {
    if (!room.startsWith('kc_') || !uuid(room.slice(3)) || !uuid(identity)) return;
    const result = await internal<{ remove?: boolean }>('event', { meetingId: room.slice(3), identity, sid, eventId, event, at: new Date(at).toISOString() });
    if (result.remove) await remove(room, identity);
  }
  return async function handler(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    };
    if (origin === deps.appOrigin) headers['Access-Control-Allow-Origin'] = origin;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
    if (origin && origin !== deps.appOrigin) return json({ error: 'Этот адрес сайта не разрешён.' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);
    try {
      if (Number(req.headers.get('content-length')) > 262144) throw new HttpError(413, 'Запрос слишком большой.');
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > 262144) throw new HttpError(413, 'Запрос слишком большой.');
      if (new URL(req.url).pathname.endsWith('/webhook')) {
        missing();
        let event;
        try { event = await receiver!.receive(raw, req.headers.get('authorization') ?? undefined); }
        catch { throw new HttpError(401, 'Подпись события не подтверждена.'); }
        if (event.room?.name && event.participant?.identity && ['participant_joined', 'participant_left'].includes(event.event ?? ''))
          await mediaEvent(event.event === 'participant_joined' ? 'joined' : 'left', event.room.name, event.participant.identity, event.participant.sid, event.id, Number(event.createdAt) * 1000);
        return json({ ok: true });
      }
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Некорректный запрос.'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new HttpError(400, 'Некорректный запрос.');
      const action = body.action;
      if (action === 'cleanup') {
        if (!sameSecret(req.headers.get('x-hook-secret') ?? '', await deps.hookSecret())) throw new HttpError(401, 'Нет доступа.');
        if (!ready) return json({ ok: true, processed: 0, videoReady: false });
        const pending = await internal<{ id: string; userId: string }[]>('pending', {});
        const results = await Promise.allSettled(pending.map(op => enforce(op.userId, op.id)));
        return json({ ok: true, processed: results.filter(x => x.status === 'fulfilled').length });
      }
      const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      if (!token) throw new HttpError(401, 'Войдите на сайт.');
      const { data: auth, error: authError } = await deps.admin.auth.getUser(token);
      if (authError || !auth.user) throw new HttpError(401, 'Войдите на сайт заново.');
      const userId = auth.user.id;
      const { data: profile, error: profileError } = await deps.admin.from('profiles').select('data').eq('id', userId).maybeSingle();
      if (profileError || !profile || profile.data.active === false || profile.data.pending) throw new HttpError(403, 'Учётная запись не активна.');
      const user = deps.userClient(token);
      if (action === 'status') return json({ chatReady: true, videoReady: ready, provider: 'livekit-cloud' });
      if (action === 'respond' || action === 'cancel_invite') {
        const result = await rpc<Record<string, unknown>>(user, 'communications', action, { requestId: body.requestId, invitationId: body.invitationId, ...(action === 'respond' ? { response: body.response } : {}) });
        if (typeof result.controlId === 'string') { missing(); await enforce(userId, result.controlId); }
        return json(result);
      }
      missing();
      if (action === 'create') {
        const result = await rpc(user, 'communications', 'create', { requestId: body.requestId, title: body.title, inviteOnly: body.inviteOnly ?? false, ...(body.peerId ? { peerId: body.peerId } : {}) });
        return json(result);
      }
      if (!uuid(body.meetingId)) throw new HttpError(400, 'Ссылка встречи недействительна.');
      const meetingId = body.meetingId;
      if (action === 'token') {
        const admitted = await rpc<Admission>(user, 'communications', 'admit', { meetingId, requestId: body.requestId });
        const access = await internal<{ revoke: string[] }>('admission', { userId, meetingId, identity: admitted.identity });
        for (let i = 0; i < access.revoke.length; i += 6) await Promise.all(access.revoke.slice(i, i + 6).map(identity => remove(admitted.room, identity)));
        await rooms!.createRoom({ name: admitted.room, emptyTimeout: 300, departureTimeout: 30 });
        const jwt = await admissionToken(media!, admitted);
        await internal('admission', { userId, meetingId, identity: admitted.identity });
        return json({ token: jwt, url: media!.url, identity: admitted.identity, room: admitted.room, expiresIn: 90 });
      }
      if (action === 'moderate') {
        const op = await rpc<{ controlId: string }>(user, 'communications', 'control', { meetingId, requestId: body.requestId, action: body.operation, ...(body.userId ? { userId: body.userId } : {}) });
        await enforce(userId, op.controlId); return json({ ok: true });
      }
      if (action === 'verify') {
        if (!uuid(body.identity)) throw new HttpError(400, 'Подключение не найдено.');
        await internal('presence', { userId, meetingId, identity: body.identity });
        const person = await rooms!.getParticipant('kc_' + meetingId, body.identity);
        const metadata = JSON.parse(person.metadata || '{}');
        if (metadata.uid !== userId) throw new HttpError(403, 'Подключение принадлежит другому пользователю.');
        await mediaEvent('joined', 'kc_' + meetingId, body.identity, person.sid, 'verify_' + crypto.randomUUID(), now());
        return json({ ok: true });
      }
      throw new HttpError(400, 'Неизвестное действие.');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      // Provider failures can contain credentials or internal URLs. Do not log or forward them.
      return json({ error: 'Видеосервис не ответил. Повторите действие; личные сообщения доступны.' }, 503);
    }
  };
}
