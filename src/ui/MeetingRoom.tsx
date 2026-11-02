import { Camera, CameraOff, Expand, FileText, Lock, MessageCircle, Mic, MicOff, Minimize2, MonitorUp, PhoneOff, Pin, RefreshCw, Square, UserMinus, UserPlus, Users, Volume2, X } from 'lucide-react';
import { createLocalAudioTrack, createLocalVideoTrack, Room, RoomEvent, Track, type LocalAudioTrack, type LocalVideoTrack, type Participant } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { activateCall, closePreparation, communicationsRpc, expandCall, finishCall, getCommunications, loadMeeting, loadRoomMessages, moderateMeeting, openMeetingMinutes, openPreparation, sendRoomMessage, useCommunications, videoApi, watchRoomMessages } from '../data/communications';
import type { ActiveCall, MediaAdmission, MeetingMessage } from '../data/communication-types';
import { useMe } from './hooks';
import { Button, Modal, toast } from './kit';
import { InvitePeopleDialog, PersonAvatar, PersonName } from './MeetingInvites';
import { go } from '../lib/router';
import { meetingWhen } from '../lib/meeting-time';

function deviceError(error: unknown) {
  const name = (error as { name?: string }).name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Доступ запрещён. Разрешите камеру или микрофон в настройках браузера либо присоединитесь без них.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Устройство не найдено. Можно присоединиться без камеры и микрофона.';
  if (name === 'NotReadableError') return 'Устройство занято другим приложением. Закройте его или присоединитесь без устройства.';
  return 'Не удалось включить устройство. Проверьте разрешения браузера и попробуйте ещё раз.';
}
function VideoElement({ track, local = false }: { track?: Track; local?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const element = ref.current; if (!track || !element) return; track.attach(element); return () => { track.detach(element); }; }, [track]);
  return <video ref={ref} autoPlay playsInline muted={local} className={local ? 'comm-self-video' : ''} />;
}
function AudioElement({ track }: { track: Track }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { const element = ref.current; if (!element) return; track.attach(element); return () => { track.detach(element); }; }, [track]);
  return <audio ref={ref} autoPlay />;
}
export function Preparation({ meetingId }: { meetingId: string }) {
  const state = useCommunications(); const me = useMe(); const detail = state.details[meetingId];
  const [video, setVideo] = useState<LocalVideoTrack | null>(null), [audio, setAudio] = useState<LocalAudioTrack | null>(null);
  const tracks = useRef<{ video: LocalVideoTrack | null; audio: LocalAudioTrack | null }>({ video: null, audio: null });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [cameraId, setCameraId] = useState(''), [micId, setMicId] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!detail?.meeting.scheduledAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [detail?.meeting.scheduledAt]);
  const waiting = !!detail?.meeting.scheduledAt && Date.parse(detail.meeting.scheduledAt) > now + state.clockOffset;
  const [error, setError] = useState(''), [capturing, setCapturing] = useState(false), [joining, setJoining] = useState(false);
  const mounted = useRef(true), transferred = useRef(false), requestId = useRef(crypto.randomUUID());
  const enumerate = () => { void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {}); };
  useEffect(() => { mounted.current = true; enumerate(); navigator.mediaDevices?.addEventListener?.('devicechange', enumerate); return () => { mounted.current = false; navigator.mediaDevices?.removeEventListener?.('devicechange', enumerate); if (!transferred.current) { tracks.current.video?.stop(); tracks.current.audio?.stop(); } }; }, []);
  const toggleCamera = async () => {
    setError(''); if (tracks.current.video) { tracks.current.video.stop(); tracks.current.video = null; setVideo(null); return; }
    setCapturing(true); try { const track = await createLocalVideoTrack({ ...(cameraId ? { deviceId: { exact: cameraId } } : {}), resolution: { width: 1280, height: 720, frameRate: 24 } }); if (!mounted.current) { track.stop(); return; } tracks.current.video = track; setVideo(track); enumerate(); } catch (error) { if (mounted.current) setError(deviceError(error)); } finally { if (mounted.current) setCapturing(false); }
  };
  const toggleMicrophone = async () => {
    setError(''); if (tracks.current.audio) { tracks.current.audio.stop(); tracks.current.audio = null; setAudio(null); return; }
    setCapturing(true); try { const track = await createLocalAudioTrack(micId ? { deviceId: { exact: micId } } : {}); if (!mounted.current) { track.stop(); return; } tracks.current.audio = track; setAudio(track); enumerate(); } catch (error) { if (mounted.current) setError(deviceError(error)); } finally { if (mounted.current) setCapturing(false); }
  };
  const join = async () => {
    if (!detail) return; setJoining(true); setError('');
    try { const admission = await videoApi<MediaAdmission>('token', { meetingId, requestId: requestId.current }); if (!mounted.current) return; transferred.current = true; activateCall({ meeting: detail.meeting, admission, tracks: [tracks.current.video, tracks.current.audio].filter((track): track is LocalVideoTrack | LocalAudioTrack => !!track) }); }
    catch (error) { if (/устарел|отозван/.test((error as Error).message)) requestId.current = crypto.randomUUID(); if (mounted.current) setError((error as Error).message); } finally { if (mounted.current) setJoining(false); }
  };
  return <Modal open onClose={() => { if (!joining) closePreparation(); }} title="Подготовка к встрече" width={900} footer={<><Button disabled={joining} onClick={closePreparation}>Отмена</Button><Button variant="primary" disabled={joining || capturing || waiting || !detail?.meeting.active || !state.videoReady} onClick={() => void join()}>{joining ? 'Подключаюсь…' : 'Присоединиться'}</Button></>}>
    <div className="comm-module comm-preparation"><div className="comm-preview">{video ? <VideoElement track={video} local /> : <div className="comm-camera-placeholder"><PersonAvatar id={me.id} size={84} /><span>Камера выключена</span></div>}<div className="comm-preview-name">{me.name}</div></div><div className="comm-preparation-options"><h3>{detail?.meeting.title ?? 'Видеовстреча'}</h3><p className="muted">{waiting ? `Подключение откроется ${meetingWhen(detail!.meeting.scheduledAt!)}.` : 'Проверьте устройства. Можно войти с выключенными камерой и микрофоном.'}</p>
      <Button icon={video ? CameraOff : Camera} disabled={capturing || joining || !navigator.mediaDevices?.getUserMedia} aria-pressed={!!video} onClick={() => void toggleCamera()}>{video ? 'Выключить камеру' : 'Включить камеру'}</Button>
      <label className="field">Камера<select className="input" value={cameraId} disabled={capturing || joining} onChange={event => { const id = event.target.value; setCameraId(id); if (tracks.current.video) void tracks.current.video.restartTrack(id ? { deviceId: { exact: id } } : {}).catch(error => setError(deviceError(error))); }}><option value="">По умолчанию</option>{devices.filter(device => device.kind === 'videoinput' && device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Камера ${index + 1}`}</option>)}</select></label>
      <Button icon={audio ? MicOff : Mic} disabled={capturing || joining || !navigator.mediaDevices?.getUserMedia} aria-pressed={!!audio} onClick={() => void toggleMicrophone()}>{audio ? 'Выключить микрофон' : 'Включить микрофон'}</Button>
      <label className="field">Микрофон<select className="input" value={micId} disabled={capturing || joining} onChange={event => { const id = event.target.value; setMicId(id); if (tracks.current.audio) void tracks.current.audio.restartTrack(id ? { deviceId: { exact: id } } : {}).catch(error => setError(deviceError(error))); }}><option value="">По умолчанию</option>{devices.filter(device => device.kind === 'audioinput' && device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Микрофон ${index + 1}`}</option>)}</select></label><p className="small muted">{audio ? 'Микрофон готов к передаче звука.' : 'Микрофон выключен.'}</p>
    </div>{error && <p className="callout error comm-span" role="alert">{error}</p>}</div>
  </Modal>;
}
function Duration({ started }: { started: number }) { const [now, setNow] = useState(Date.now()); useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []); const seconds = Math.max(0, Math.floor((now - started) / 1000)); return <span>{Math.floor(seconds / 3600) ? Math.floor(seconds / 3600) + ':' : ''}{String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span>; }
function userIdentity(participant: Participant) { try { const uid = JSON.parse(participant.metadata || '{}').uid; return typeof uid === 'string' ? uid : ''; } catch { return ''; } }
function ParticipantTile({ participant, local, speaking, pinned, onPin }: { participant: Participant; local: boolean; speaking: boolean; pinned: boolean; onPin: () => void }) {
  const publication = participant.getTrackPublication(Track.Source.Camera); const video = publication?.track && !publication.isMuted ? publication.track : undefined; const userId = userIdentity(participant);
  return <div className={`comm-video-tile ${speaking ? 'comm-speaking' : ''} ${pinned ? 'comm-pinned' : ''}`} data-participant={participant.identity}>
    {video ? <VideoElement track={video} local={local} /> : <div className="comm-camera-placeholder"><PersonAvatar id={userId} size={76} /></div>}
    <div className="comm-tile-label"><span className="grow"><PersonName id={userId} />{local && ' · Вы'}</span>{!participant.isMicrophoneEnabled && <MicOff size={15} aria-label="Микрофон выключен" />}{!video && <CameraOff size={15} aria-label="Камера выключена" />}<button type="button" className="comm-tile-pin" onClick={onPin} aria-label={pinned ? 'Открепить участника' : 'Закрепить участника'} aria-pressed={pinned}><Pin size={15} /></button></div>
  </div>;
}
function MeetingChat({ meetingId }: { meetingId: string }) {
  const me = useMe(); const [messages, setMessages] = useState<MeetingMessage[]>([]), [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const attempt = useRef({ text: '', id: '' }), end = useRef<HTMLDivElement>(null);
  useEffect(() => { let active = true; const refresh = () => { void loadRoomMessages(meetingId).then(rows => { if (active) { setMessages(rows); setError(''); } }).catch(error => { if (active) setError((error as Error).message); }); }; refresh(); const unwatch = watchRoomMessages(meetingId, refresh); const timer = setInterval(refresh, 12000); return () => { active = false; unwatch(); clearInterval(timer); }; }, [meetingId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);
  const send = async () => { const content = text.trim(); if (!content) return; if (attempt.current.text !== content) attempt.current = { text: content, id: crypto.randomUUID() }; setBusy(true); try { await sendRoomMessage(meetingId, content, attempt.current.id); setText(value => value === text ? '' : value); setMessages(await loadRoomMessages(meetingId)); setError(''); attempt.current = { text: '', id: '' }; } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  return <div className="comm-room-chat"><h3>Чат встречи</h3><p className="small muted">Последние 100 сообщений. История доступна во время этой встречи, в том числе после переподключения, и очищается после завершения.</p><div className="comm-room-chat-history">{messages.map(message => <article className={`comm-room-message ${message.senderId === me.id ? 'mine' : ''}`} key={message.id}><header><b><PersonName id={message.senderId} /></b><time>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })}</time></header><p>{message.text}</p></article>)}<div ref={end} /></div>{error && <p className="small comm-error" role="alert">{error}</p>}<form className="comm-compose" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="comm-room-text">Сообщение в чат встречи</label><textarea id="comm-room-text" className="input" value={text} onChange={event => setText(event.target.value)} maxLength={2000} rows={2} placeholder="Написать в чат встречи" /><Button type="submit" variant="primary" disabled={busy || !text.trim()}>Отправить</Button></form></div>;
}
export function ActiveMeeting({ call }: { call: ActiveCall }) {
  const me = useMe(); const state = useCommunications(); const detail = state.details[call.meeting.id];
  const roomRef = useRef<Room | null>(null); if (!roomRef.current) roomRef.current = new Room({ adaptiveStream: true, dynacast: true });
  const room = roomRef.current; const mounted = useRef(false), connected = useRef<Promise<void> | null>(null);
  const [, setVersion] = useState(0); const [status, setStatus] = useState('Подключение…'), [error, setError] = useState(''), [failed, setFailed] = useState(false), [audioBlocked, setAudioBlocked] = useState(false), [pinned, setPinned] = useState<string | null>(null);
  const [side, setSide] = useState<'chat' | 'people' | null>(null), [inviteOpen, setInviteOpen] = useState(false), [endConfirm, setEndConfirm] = useState(false), [busy, setBusy] = useState(false), [unseen, setUnseen] = useState(0);
  const appliedOps = useRef(new Map<string, string>());
  useEffect(() => {
    mounted.current = true;
    const update = () => { if (mounted.current) setVersion(version => version + 1); };
    const disconnected = () => { call.tracks.forEach(track => track.stop()); if (mounted.current) { setFailed(true); setStatus('Соединение прервано'); setError('Связь со встречей завершилась. Можно снова проверить устройства и подключиться.'); } };
    const reconnecting = () => { if (mounted.current) setStatus('Переподключение…'); };
    const reconnected = () => { if (mounted.current) { setStatus('На связи'); setError(''); } };
    const audio = () => { if (mounted.current) setAudioBlocked(!room.canPlaybackAudio); };
    const events = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.ConnectionQualityChanged];
    events.forEach(event => room.on(event, update)); room.on(RoomEvent.Disconnected, disconnected).on(RoomEvent.Reconnecting, reconnecting).on(RoomEvent.Reconnected, reconnected).on(RoomEvent.AudioPlaybackStatusChanged, audio);
    if (!connected.current) connected.current = (async () => {
      try {
        await room.connect(call.admission.url, call.admission.token, { autoSubscribe: true });
        if (!mounted.current) { await room.disconnect(); return; }
        for (const track of call.tracks) { if (!mounted.current) { track.stop(); continue; } await room.localParticipant.publishTrack(track, { source: track.kind === 'audio' ? Track.Source.Microphone : Track.Source.Camera }); }
        await room.startAudio().catch(() => { if (mounted.current) setAudioBlocked(true); });
        await videoApi('verify', { meetingId: call.meeting.id, identity: call.admission.identity });
        if (mounted.current) { setStatus('На связи'); update(); void loadMeeting(call.meeting.id).catch(() => {}); }
      } catch (error) { await room.disconnect(true); call.tracks.forEach(track => track.stop()); if (mounted.current) { setFailed(true); setError((error as Error).message); setStatus('Не удалось подключиться'); } }
    })();
    const verify = setInterval(() => {
      if (room.state !== 'connected') return;
      void videoApi('verify', { meetingId: call.meeting.id, identity: call.admission.identity }).catch(error => { if ((error as { status?: number }).status === 403 || (error as { status?: number }).status === 401) finishCall((error as Error).message); });
    }, 15000);
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false; clearInterval(verify); window.removeEventListener('beforeunload', beforeUnload);
      events.forEach(event => room.off(event, update)); room.off(RoomEvent.Disconnected, disconnected).off(RoomEvent.Reconnecting, reconnecting).off(RoomEvent.Reconnected, reconnected).off(RoomEvent.AudioPlaybackStatusChanged, audio);
      // StrictMode's immediate effect re-subscription reuses this real connection.
      setTimeout(() => { if (mounted.current) return; void room.disconnect(true); call.tracks.forEach(track => track.stop()); if (getCommunications().userId === me.id) void communicationsRpc('leave', { meetingId: call.meeting.id, identity: call.admission.identity }).catch(() => {}); }, 0);
    };
  }, [call.admission.identity]);
  useEffect(() => { if (side === 'chat') { setUnseen(0); return; } let active = true, initial = true, lastSeq = 0n; const check = () => { void loadRoomMessages(call.meeting.id).then(rows => { if (!active) return; if (!initial) setUnseen(value => value + rows.filter(message => message.senderId !== me.id && BigInt(message.seq) > lastSeq).length); initial = false; lastSeq = BigInt(rows.at(-1)?.seq ?? '0'); }).catch(() => {}); }; check(); const unwatch = watchRoomMessages(call.meeting.id, check); const timer = setInterval(check, 12000); return () => { active = false; unwatch(); clearInterval(timer); }; }, [side, call.meeting.id, me.id]);
  const local = room.localParticipant; const people: Participant[] = [local, ...room.remoteParticipants.values()];
  const shared = people.find(person => { const pub = person.getTrackPublication(Track.Source.ScreenShare); return pub?.track && !pub.isMuted; });
  const screenTrack = shared?.getTrackPublication(Track.Source.ScreenShare)?.track;
  const focus = !screenTrack && pinned ? people.find(person => person.identity === pinned) : undefined;
  const callAction = async (action: () => Promise<unknown>) => { setError(''); try { await action(); setVersion(value => value + 1); } catch (error) { setError(deviceError(error)); } };
  const moderate = async (action: 'end' | 'lock' | 'unlock' | 'remove' | 'mute', userId?: string) => {
    const key = action + ':' + (userId ?? ''); const rid = appliedOps.current.get(key) ?? crypto.randomUUID(); appliedOps.current.set(key, rid); setBusy(true); setError('');
    try { await moderateMeeting(call.meeting.id, action, userId, rid); appliedOps.current.delete(key); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const tile = (person: Participant) => <ParticipantTile key={person.identity} participant={person} local={person === local} speaking={room.activeSpeakers.some(speaker => speaker.identity === person.identity)} pinned={pinned === person.identity} onPin={() => setPinned(value => value === person.identity ? null : person.identity)} />;
  return <section className={`comm-module comm-call ${state.callExpanded ? 'comm-call-expanded' : 'comm-call-compact'}`} aria-label="Активная видеовстреча">
    <header className="comm-call-header"><div className="grow"><h2>{call.meeting.title}</h2><p><span className="comm-live-dot" />{status}<span> · </span><Duration started={Date.parse(call.meeting.startsAt || call.meeting.scheduledAt || call.meeting.createdAt)} /><span> · {people.length} {people.length === 1 ? 'участник' : 'участника'}</span></p></div><Button variant="ghost" iconOnly icon={state.callExpanded ? Minimize2 : Expand} aria-label={state.callExpanded ? 'Свернуть встречу' : 'Развернуть встречу'} onClick={() => expandCall(!state.callExpanded)} /></header>
    {error && <div className="comm-call-error" role="alert">{error}{failed && <Button icon={RefreshCw} onClick={() => { finishCall(); go('/meetings/' + call.meeting.id); void openPreparation(call.meeting.id).catch(error => toast(error.message, 'error')); }}>Подключиться снова</Button>}</div>}
    {audioBlocked && <Button icon={Volume2} variant="primary" onClick={() => void room.startAudio().then(() => setAudioBlocked(false)).catch(() => setError('Браузер не разрешил звук. Проверьте настройки воспроизведения.'))}>Включить звук встречи</Button>}
    <div className={`comm-call-body ${side && state.callExpanded ? 'comm-with-side' : ''}`}><div className="comm-media-stage">
      {screenTrack ? <div className="comm-screen-stage"><VideoElement track={screenTrack} local={shared === local} /><span>Экран: <PersonName id={userIdentity(shared!)} /></span></div> : focus && <div className="comm-focus-stage">{tile(focus)}</div>}
      <div className={`comm-video-grid ${screenTrack || focus ? 'comm-video-strip' : ''}`}>{people.map(tile)}</div>
    </div>{side && state.callExpanded && <aside className="comm-call-side"><div className="row"><span className="grow" /><Button size="sm" iconOnly icon={X} variant="ghost" aria-label="Закрыть боковую панель" onClick={() => setSide(null)} /></div>{side === 'chat' ? <MeetingChat meetingId={call.meeting.id} /> : <><h3>Участники · {people.length}</h3><div className="comm-people">{people.map(person => { const uid = userIdentity(person); return <div key={person.identity} className="comm-person-row"><PersonAvatar id={uid} /><span className="grow"><PersonName id={uid} />{person === local && <small>Вы{call.meeting.ownerId === me.id ? ' · Организатор' : ''}</small>}</span>{!person.isMicrophoneEnabled && <MicOff size={15} />}{call.meeting.ownerId === me.id && uid && uid !== me.id && <><Button iconOnly size="sm" icon={MicOff} aria-label="Отключить микрофон участника" disabled={busy} onClick={() => void moderate('mute', uid)} /><Button iconOnly size="sm" icon={UserMinus} variant="danger" aria-label="Удалить участника из встречи" disabled={busy} onClick={() => void moderate('remove', uid)} /></>}</div>; })}</div>{call.meeting.ownerId === me.id && <div className="comm-owner-actions"><Button icon={Lock} disabled={busy} onClick={() => void moderate(detail?.meeting.locked ? 'unlock' : 'lock')}>{detail?.meeting.locked ? 'Открыть вход' : 'Закрыть вход'}</Button><Button variant="danger" disabled={busy} onClick={() => setEndConfirm(true)}>Завершить встречу для всех</Button></div>}</>}</aside>}</div>
    <div className="comm-remote-audio" aria-hidden>{[...room.remoteParticipants.values()].flatMap(person => [...person.audioTrackPublications.values()].filter(publication => publication.track).map(publication => <AudioElement key={publication.trackSid} track={publication.track!} />))}</div>
    <footer className="comm-call-controls"><Button disabled={room.state !== 'connected'} icon={local.isMicrophoneEnabled ? Mic : MicOff} aria-pressed={local.isMicrophoneEnabled} aria-label={local.isMicrophoneEnabled ? 'Выключить микрофон' : 'Включить микрофон'} onClick={() => void callAction(() => local.setMicrophoneEnabled(!local.isMicrophoneEnabled))}><span className="comm-control-label">Микрофон</span></Button><Button disabled={room.state !== 'connected'} icon={local.isCameraEnabled ? Camera : CameraOff} aria-pressed={local.isCameraEnabled} aria-label={local.isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'} onClick={() => void callAction(() => local.setCameraEnabled(!local.isCameraEnabled))}><span className="comm-control-label">Камера</span></Button>
      <Button icon={FileText} aria-label="Повестка и протокол" onClick={() => openMeetingMinutes(call.meeting.id)}><span className="comm-control-label">Протокол</span></Button>
      <Button icon={MonitorUp} aria-label="Демонстрация экрана" aria-pressed={local.isScreenShareEnabled} disabled={room.state !== 'connected' || !navigator.mediaDevices?.getDisplayMedia} title={!navigator.mediaDevices?.getDisplayMedia ? 'Браузер не поддерживает демонстрацию экрана' : undefined} onClick={() => void callAction(() => local.setScreenShareEnabled(!local.isScreenShareEnabled, { audio: true }))}><span className="comm-control-label">Экран</span></Button>
      <Button icon={MessageCircle} aria-label={`Чат встречи${unseen ? ', новых сообщений: ' + unseen : ''}`} aria-pressed={side === 'chat'} onClick={() => { expandCall(true); setSide(value => value === 'chat' ? null : 'chat'); }}><span className="comm-control-label">Чат{unseen ? ` · ${unseen}` : ''}</span></Button><Button icon={Users} aria-label="Участники" aria-pressed={side === 'people'} onClick={() => { expandCall(true); setSide(value => value === 'people' ? null : 'people'); }}><span className="comm-control-label">Участники</span></Button><Button icon={UserPlus} aria-label="Пригласить пользователей" onClick={() => setInviteOpen(true)}><span className="comm-control-label">Пригласить</span></Button><>{call.meeting.ownerId === me.id && <Button variant="danger" icon={Square} aria-label="Завершить встречу" onClick={() => setEndConfirm(true)}><span className="comm-control-label">Завершить</span></Button>}<Button variant="danger" icon={PhoneOff} onClick={() => finishCall()}>Выйти</Button></></footer>
    <InvitePeopleDialog meetingId={call.meeting.id} open={inviteOpen} onClose={() => setInviteOpen(false)} />
    <Modal open={endConfirm} onClose={() => setEndConfirm(false)} title="Завершить встречу для всех?" footer={<><Button onClick={() => setEndConfirm(false)}>Продолжить встречу</Button><Button variant="danger" disabled={busy} onClick={() => void moderate('end')}>Завершить для всех</Button></>}><p>Все участники отключатся. Войти в эту встречу и продолжить её чат будет нельзя.</p></Modal>
  </section>;
}
