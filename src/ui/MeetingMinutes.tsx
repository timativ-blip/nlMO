import { Copy, Download, RefreshCw, Save, Send, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeetingDocumentContent, MeetingDocuments } from '../data/communication-types';
import { assignMeetingSecretary, closeMeetingMinutes, loadMeetingDocuments, publishMeetingMinutes, saveMeetingDocuments, useCommunications } from '../data/communications';
import { meetingWhen } from '../lib/meeting-time';
import { useMe } from './hooks';
import { PersonName } from './MeetingInvites';
import { Button, Modal, toast } from './kit';
import AiMinutes from './AiMinutes';

const blank = (): MeetingDocumentContent => ({ agenda: '', summary: '', decisions: '', actions: '' });
const fields: { key: keyof MeetingDocumentContent; label: string; placeholder: string }[] = [
  { key: 'agenda', label: 'Повестка', placeholder: 'Вопросы, которые нужно обсудить на встрече' },
  { key: 'summary', label: 'Итоги обсуждения', placeholder: 'Что обсудили и к чему пришли' },
  { key: 'decisions', label: 'Принятые решения', placeholder: 'Зафиксируйте каждое решение с новой строки' },
  { key: 'actions', label: 'Поручения, ответственные и сроки', placeholder: 'Что сделать · кто отвечает · к какой дате' },
];
const normalized = (content: MeetingDocumentContent) => Object.fromEntries(Object.entries(content).map(([key, value]) => [key, value.trim()])) as unknown as MeetingDocumentContent;
const same = (a: MeetingDocumentContent, b: MeetingDocumentContent) => fields.every(({ key }) => a[key].trim() === b[key].trim());
const asText = (doc: MeetingDocuments) => `Протокол встречи «${doc.title}» · версия ${doc.published!.revision}\n${meetingWhen(doc.published!.publishedAt)}\n\n` + fields.filter(({ key }) => doc.published!.content[key]).map(({ key, label }) => `${label}\n${doc.published!.content[key]}`).join('\n\n');

function PublishedMinutes({ doc }: { doc: MeetingDocuments }) {
  if (!doc.published) return <p className="muted">Протокол ещё не отправлен участникам.</p>;
  const copy = async () => { try { await navigator.clipboard.writeText(asText(doc)); toast('Протокол скопирован.'); } catch { toast('Не удалось скопировать. Скачайте протокол.', 'error'); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([asText(doc)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `Протокол-${doc.meetingId}-v${doc.published!.revision}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <article className="comm-minutes-published">
    <header><h3>Протокол · версия {doc.published.revision}</h3><p className="small muted">{meetingWhen(doc.published.publishedAt)} · <PersonName id={doc.published.publishedBy} /></p></header>
    {fields.filter(({ key }) => doc.published!.content[key]).map(({ key, label }) => <section key={key}><h4>{label}</h4><p>{doc.published!.content[key]}</p></section>)}
    <div className="comm-inline-actions"><Button size="sm" icon={Copy} onClick={() => void copy()}>Скопировать</Button><Button size="sm" icon={Download} onClick={download}>Скачать протокол</Button></div>
  </article>;
}

export default function MeetingMinutes({ meetingId }: { meetingId: string }) {
  const state = useCommunications(), me = useMe();
  const [doc, setDoc] = useState<MeetingDocuments | null>(null), [content, setContent] = useState(blank), [baseContent, setBaseContent] = useState(blank), [version, setVersion] = useState(0);
  const [responsible, setResponsible] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmSend, setConfirmSend] = useState(false), [confirmClose, setConfirmClose] = useState(false);
  const mounted = useRef(true), pending = useRef(false), dirtyRef = useRef(false), sequence = useRef(0), attempts = useRef(new Map<string, string>());
  const dirty = !!doc?.canEdit && !same(content, baseContent); dirtyRef.current = dirty;
  const accept = useCallback((next: MeetingDocuments, force = false) => {
    setDoc(next); setError('');
    if (force || !dirtyRef.current || !next.canEdit) {
      const value = next.draft?.content ?? blank(); setContent(value); setBaseContent(value); setVersion(next.draft?.version ?? 0); dirtyRef.current = false;
    }
  }, []);
  const refresh = useCallback(async () => {
    if (pending.current) return; const ticket = ++sequence.current;
    try { const next = await loadMeetingDocuments(meetingId); if (mounted.current && ticket === sequence.current && !pending.current) accept(next); }
    catch (error) { if (mounted.current && ticket === sequence.current) setError((error as Error).message); }
  }, [meetingId, accept]);
  useEffect(() => { mounted.current = true; void refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 12000); return () => { mounted.current = false; ++sequence.current; clearInterval(timer); }; }, [refresh]);
  useEffect(() => { if (doc) setResponsible(doc.responsibleId); }, [doc?.responsibleId]);
  useEffect(() => { if (!dirty) return; const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent); }, [dirty]);
  const requestId = (key: string) => { if (!attempts.current.has(key)) attempts.current.set(key, crypto.randomUUID()); return attempts.current.get(key)!; };
  const begin = () => { pending.current = true; ++sequence.current; setBusy(true); setError(''); };
  const finish = () => { pending.current = false; if (mounted.current) setBusy(false); };
  const persist = async () => {
    const value = normalized(content);
    const saved = await saveMeetingDocuments(meetingId, value, version, requestId('save:' + version + ':' + JSON.stringify(value)));
    if (mounted.current) accept(saved, true); return saved;
  };
  const save = async (close = false) => { begin(); try { await persist(); if (mounted.current) { toast('Повестка и черновик сохранены.'); if (close) closeMeetingMinutes(); } } catch (error) { if (mounted.current) setError((error as Error).message); } finally { finish(); } };
  const assign = async () => {
    const key = 'assign:' + responsible;
    begin(); try { const next = await assignMeetingSecretary(meetingId, responsible, requestId(key)); attempts.current.delete(key); if (mounted.current) { accept(next); toast('Ответственный назначен и получит уведомление.'); } }
    catch (error) { if (mounted.current) setError((error as Error).message); } finally { finish(); }
  };
  const publish = async () => {
    if (!doc) return; begin();
    try {
      const saved = dirty ? await persist() : doc;
      const expected = saved.draft!.version;
      const next = await publishMeetingMinutes(meetingId, expected, requestId('publish:' + expected));
      if (mounted.current) { accept(next, true); setConfirmSend(false); toast(`Протокол отправлен. Получателей: ${next.published?.recipients ?? 0}.`); }
    } catch (error) { if (mounted.current) { setError((error as Error).message); setConfirmSend(false); } } finally { finish(); }
  };
  const close = () => { if (busy) return; if (dirty) setConfirmClose(true); else closeMeetingMinutes(); };
  const canPublish = !!doc?.canEdit && ['summary', 'decisions', 'actions'].some(key => content[key as keyof MeetingDocumentContent].trim()) && (dirty || doc.published?.draftVersion !== version);
  const contacts = [{ id: me.id, name: me.name }, ...state.contacts].filter((person, index, all) => all.findIndex(item => item.id === person.id) === index).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return <>
    <Modal open title="Повестка и протокол" onClose={close} width={900} footer={<>
      <Button disabled={busy} onClick={close}>Закрыть</Button>
      {doc?.canEdit && <><Button icon={Save} disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить черновик'}</Button><Button variant="primary" icon={Send} disabled={busy || !canPublish} onClick={() => setConfirmSend(true)}>Отправить протокол участникам</Button></>}
    </>}>
      <div className="comm-module comm-minutes">
        {!doc && !error && <p role="status">Загружаю документы встречи…</p>}
        {error && <div className="callout error" role="alert">{error}<Button size="sm" icon={RefreshCw} disabled={busy} onClick={() => void refresh()}>Повторить загрузку</Button></div>}
        {doc && <><h3>{doc.title}</h3><p className="comm-secretary"><UserCheck size={18} /><span>Ответственный за повестку и протокол: <b><PersonName id={doc.responsibleId} /></b></span></p>
          {doc.ownerId === me.id && <div className="comm-secretary-assign"><label className="field">Назначить ответственного<select className="input" aria-label="Ответственный за повестку и протокол" value={responsible} disabled={busy} onChange={event => setResponsible(event.target.value)}>{!contacts.some(person => person.id === responsible) && <option value={responsible}>Текущий ответственный</option>}{contacts.map(person => <option key={person.id} value={person.id}>{person.name}{person.id === me.id ? ' (вы)' : ''}</option>)}</select></label><Button disabled={busy || responsible === doc.responsibleId} onClick={() => void assign()}>Назначить</Button></div>}
          {doc.canEdit ? <>
            <p className="small muted">Повестка видна сотрудникам с доступом к встрече после сохранения. Черновик протокола видят только организатор и ответственный. Итоги можно дописать после звонка.</p>
            {doc.draft && doc.draft.version !== version && dirty && <p className="callout warning" role="status">В другом окне появились новые правки. Скопируйте свой текст перед загрузкой сохранённой версии.<Button size="sm" onClick={() => { accept(doc, true); }}>Загрузить сохранённую версию</Button></p>}
            <AiMinutes target={{meetingId}} onApply={setContent} />
            <div className="comm-minutes-fields">{fields.map(({ key, label, placeholder }) => <label key={key} className="field">{label}<textarea className="input" rows={key === 'agenda' ? 3 : 4} maxLength={8000} aria-label={label} value={content[key]} disabled={busy} onChange={event => setContent(value => ({ ...value, [key]: event.target.value }))} placeholder={placeholder} /><span className="small muted">{content[key].length} / 8000</span></label>)}</div>
            <p className="small muted" role="status">{dirty ? 'Есть несохранённые изменения.' : doc.draft?.updatedAt ? `Черновик сохранён: ${meetingWhen(doc.draft.updatedAt)}.` : 'Начните с повестки или назначьте ответственного.'}</p>
            {doc.published && <details className="comm-minutes-previous"><summary>Отправленная версия {doc.published.revision} · получателей: {doc.published.recipients}</summary><PublishedMinutes doc={doc} /></details>}
          </> : <>
            <section className="comm-minutes-agenda"><h3>Повестка</h3><p>{doc.agenda || 'Повестка пока не заполнена.'}</p></section><PublishedMinutes doc={doc} />
          </>}
        </>}
      </div>
    </Modal>
    <Modal open={confirmSend} title="Отправить протокол участникам?" onClose={() => { if (!busy) setConfirmSend(false); }} footer={<><Button disabled={busy} onClick={() => setConfirmSend(false)}>Вернуться к тексту</Button><Button variant="primary" disabled={busy} icon={Send} onClick={() => void publish()}>{busy ? 'Отправляю…' : 'Да, отправить протокол'}</Button></>}>
      <div className="comm-module"><p>Протокол получат организатор, ответственный и все, кто подключался, включая уже вышедших. Сейчас получателей: {doc?.eligibleRecipients ?? 0}.</p><p>Уведомление появится на сайте и в подключённом Telegram с учётом настроек получателя. Длинный протокол будет доступен целиком по ссылке.</p><p className="small muted">Если встреча ещё идёт, новые участники получат текущую версию после подключения. При повторной отправке изменений придёт новая версия.</p></div>
    </Modal>
    <Modal open={confirmClose} title="Сохранить изменения перед закрытием?" onClose={() => setConfirmClose(false)} footer={<><Button disabled={busy} onClick={() => setConfirmClose(false)}>Продолжить редактирование</Button><Button disabled={busy} onClick={closeMeetingMinutes}>Закрыть без сохранения</Button><Button variant="primary" disabled={busy} onClick={() => void save(true)}>Сохранить и закрыть</Button></>}><p>В документе есть несохранённые правки.</p></Modal>
  </>;
}
