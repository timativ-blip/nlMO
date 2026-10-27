// «Что публикуем»: медиа-штаб выкладывает шаблон на день — команда получает его в колокольчик и Telegram
// и может скопировать текст одним нажатием.
import { Copy, ExternalLink, Megaphone, Send } from 'lucide-react';
import { useState } from 'react';
import { canPublishBrief, publishBrief, useAppState } from '../data/store';
import type { Brief } from '../data/types';
import { fmtDayLong, fmtStamp, todayISO } from '../lib/date';
import { useLookup, useMe } from '../ui/hooks';
import { Button, Empty, Field, Input, run, Textarea, toast } from '../ui/kit';

const fullText = (b: Brief) => [b.text, b.hashtags, b.link].filter(Boolean).join('\n\n');

export default function BriefsView() {
  const s = useAppState();
  const me = useMe();
  const list = [...s.briefs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const todays = list.filter((b) => b.day === todayISO());
  const older = list.filter((b) => b.day !== todayISO()).slice(0, 20);
  return (
    <div className={canPublishBrief(me) ? 'grid g-main' : ''} style={{ alignItems: 'start' }}>
      <div className="col" style={{ gap: 14 }}>
        <h2 className="section-title">Сегодня</h2>
        {todays.length ? todays.map((b) => <BriefCard key={b.id} b={b} big />) : <div className="card"><Empty icon={Megaphone} title="На сегодня шаблона пока нет" text="Как только медиа-штаб его опубликует, он придёт в колокольчик и в Telegram." /></div>}
        {older.length > 0 && <><h2 className="section-title" style={{ marginTop: 8 }}>Ранее</h2>{older.map((b) => <BriefCard key={b.id} b={b} />)}</>}
      </div>
      {canPublishBrief(me) && <BriefForm />}
    </div>
  );
}

function BriefCard({ b, big }: { b: Brief; big?: boolean }) {
  const L = useLookup();
  const copy = async () => {
    try { await navigator.clipboard.writeText(fullText(b)); toast('Текст скопирован — вставьте его в свой пост'); } catch { toast('Не удалось скопировать — выделите текст вручную', 'error'); }
  };
  return (
    <article className={`card card-pad col brief ${big ? 'brief-today' : ''}`} style={{ gap: 10 }}>
      <div className="row wrap"><b className="grow" style={{ fontSize: big ? 18 : 15 }}>{b.title}</b><span className="small muted">{L.user(b.authorId)?.name ?? 'Медиа-штаб'} · {big ? fmtStamp(b.createdAt).split(', ')[1] : fmtDayLong(b.day)}</span></div>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{b.text}</p>
      {b.hashtags && <div className="small" style={{ color: 'var(--teal-dark)', fontWeight: 600 }}>{b.hashtags}</div>}
      <div className="row wrap">
        <Button variant={big ? 'primary' : 'secondary'} size="sm" icon={Copy} onClick={copy}>Скопировать текст</Button>
        {b.link && <a className="btn btn-ghost btn-sm" href={b.link} target="_blank" rel="noreferrer"><ExternalLink size={15} />Материал</a>}
      </div>
    </article>
  );
}

function BriefForm() {
  const [v, setV] = useState({ title: '', text: '', hashtags: '#НовыеЛюди #Подмосковье', link: '' });
  const publish = () => {
    if (run(() => publishBrief(v), 'Шаблон опубликован — команда получит его в колокольчик и Telegram')) setV({ ...v, title: '', text: '', link: '' });
  };
  return (
    <div className="card card-pad col" style={{ gap: 12, position: 'sticky', top: 90 }}>
      <h2 className="row"><Megaphone size={18} />Новый шаблон</h2>
      <Field label="Тема" required><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Например: итоги субботника" /></Field>
      <Field label="Текст или подсказка, что написать" required><Textarea rows={7} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} placeholder="Готовый текст поста или короткое задание: о чём, с каким фото, кого отметить" /></Field>
      <Field label="Хештеги"><Input value={v.hashtags} onChange={(e) => setV({ ...v, hashtags: e.target.value })} /></Field>
      <Field label="Ссылка на материал (фото, видео, исходный пост)"><Input value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} placeholder="https://" /></Field>
      <Button variant="primary" icon={Send} onClick={publish}>Опубликовать и разослать</Button>
      <span className="small muted">Уйдёт всей команде: в колокольчик и в Telegram тем, кто подключил бота.</span>
    </div>
  );
}
