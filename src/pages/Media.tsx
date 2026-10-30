// «Пиши-Делись» и «Анализ медиа» — перенесено из отдельного приложения media-podmoskovya.
// Данные: Supabase-функции media-pd (посты из выгрузки «Пиши-Делись» + список людей по округам)
// и media-groups (последний пост в партийных группах ВК и Telegram по таблице групп).
import { ChevronLeft, ChevronRight, ExternalLink, Eye, Heart, Info, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { FUNCTIONS_URL } from '../lib/supabase';
import { go, type Route } from '../lib/router';
import { MONTHS_NOM, plural } from '../lib/date';
import { Bar, Button, Drawer, Empty, Segmented, Tabs } from '../ui/kit';
import { MoMap } from '../ui/widgets';
import BriefsView from './Briefs';
import { DEMO_MODE, getState } from '../data/store';
import { demoMedia } from '../data/demo-media';

type Src = 'vk' | 'tg' | 'youtube' | 'tiktok' | 'instagram' | 'other';
// [дата, заголовок, канал, источник, автор, баллы, вклад, просмотры, лайки, комм., репосты, избранное, url, засчитан, причина]
export type Post = [string, string, string, Src, number, number, number, number, number, number, number, number, string, 0 | 1, string];
export interface PdData { groups: { id: string; num: number; name: string }[]; people: [string, string][]; posts: Post[]; updated: string }
interface Channel { status: 'ok' | 'empty' | 'closed' | 'error' | 'nokey'; last?: string; url?: string; link?: string; about?: string }
interface GroupRow { okrug: string; city: string; coord: string; resp: string; vk: Channel | null; tg: Channel | null }
export interface GroupsData { groups: GroupRow[]; vkEnabled: boolean; updated: string }

const SRC_ORDER: Src[] = ['vk', 'tg', 'youtube', 'tiktok', 'instagram'];
const SRC_LABEL: Record<Src, string> = { vk: 'ВКонтакте', tg: 'Telegram', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', other: 'Другое' };
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const fmt = (x: number) => nf.format(Math.round(x * 10) / 10);
const posts_ = (n: number) => plural(n, ['пост', 'поста', 'постов']);
const authors_ = (n: number) => plural(n, ['автор', 'автора', 'авторов']);
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();
const counted = (p: Post) => p[13] !== 0;
function reasonOf(t: string) {
  if (/просмотр/i.test(t)) return 'мало просмотров (меньше 50)';
  if (/недоступ/i.test(t)) return 'пост недоступен';
  if (/ключев/i.test(t)) return 'нет ключевых слов';
  return t.trim().slice(0, 60) || 'условия не выполнены';
}

export function useJson<T>(name: string, everyMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    if (DEMO_MODE) { setData(demoMedia(name, getState()) as T); setError(false); return; }
    const load = () => fetch(`${FUNCTIONS_URL}/${name}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { if (alive && !d.error) { setData(d); setError(false); } }).catch(() => alive && setError(true));
    load();
    const t = setInterval(load, everyMs);
    return () => { alive = false; clearInterval(t); };
  }, [name, everyMs]);
  return { data, error };
}

interface Person { i: number; name: string; g: string; pts: number; ptsOk: number; ptsBad: number; contrib: number; views: number; likes: number; posts: number; okPosts: number; bad: number; reasons: Map<string, number>; src: Partial<Record<Src, { pts: number; views: number; posts: number }>> }
interface Group { id: string; num: number; label: string; roster: number; authors: number; pts: number; posts: number; views: number; mem: Person[] }

export function compute(D: PdData, month: string) {
  const P = D.posts.filter((p) => p[0].startsWith(month));
  const people: Person[] = D.people.map(([name, g], i) => ({ i, name, g, pts: 0, ptsOk: 0, ptsBad: 0, contrib: 0, views: 0, likes: 0, posts: 0, okPosts: 0, bad: 0, reasons: new Map(), src: {} }));
  for (const p of P) {
    const a = people[p[4]];
    if (!a) continue;
    if (counted(p)) { a.ptsOk += p[5]; a.okPosts++; }
    else {
      a.bad++; a.ptsBad += p[5];
      [...new Set(String(p[14] || '').split(';').map(reasonOf))].forEach((x) => a.reasons.set(x, (a.reasons.get(x) ?? 0) + 1));
    }
    a.pts += p[5]; a.contrib += p[6]; a.views += p[7]; a.likes += p[8]; a.posts++;
    const s = (a.src[p[3]] ??= { pts: 0, views: 0, posts: 0 });
    s.pts += p[5]; s.views += p[7]; s.posts++;
  }
  const label = (id: string) => { if (id === 'none') return 'Без округа'; const g = D.groups.find((x) => x.id === id); return g ? (g.num ? `${g.num} ${g.name}` : g.name) : ''; };
  const groups: Group[] = [...D.groups, { id: 'none', num: 0, name: 'Без округа' }].map((g) => {
    const mem = people.filter((a) => a.g === g.id);
    const act = mem.filter((a) => a.posts > 0);
    const sum = (k: 'pts' | 'posts' | 'views') => act.reduce((s, a) => s + a[k], 0);
    return { id: g.id, num: g.num, label: label(g.id), roster: g.id === 'none' ? act.length : mem.length, authors: act.length, pts: sum('pts'), posts: sum('posts'), views: sum('views'), mem };
  });
  return { P, people, groups, label };
}
type Calc = ReturnType<typeof compute>;

const SrcIcon = ({ s }: { s: Src }) => <span className={`src-ic src-${s}`} title={SRC_LABEL[s]}>{s === 'vk' ? 'VK' : s === 'tg' ? 'TG' : s === 'youtube' ? 'YT' : s === 'tiktok' ? 'TT' : s === 'instagram' ? 'IG' : '•'}</span>;

type View = 'brief' | 'dash' | 'okr' | 'aut' | 'loose' | 'idle' | 'groups';
export default function MediaPage({ route }: { route: Route }) {
  const view = (route.parts[1] as View) || 'dash';
  const pd = useJson<PdData>('media-pd', 60000);
  const months = useMemo(() => (pd.data ? [...new Set(pd.data.posts.map((p) => p[0].slice(0, 7)))].sort() : []), [pd.data]);
  const [month, setMonth] = useState('');
  useEffect(() => { if (months.length && !months.includes(month)) setMonth(months[months.length - 1]); }, [months]); // eslint-disable-line
  const A = useMemo(() => (pd.data && month ? compute(pd.data, month) : null), [pd.data, month]);
  const [sheet, setSheet] = useState<{ t: 'g' | 'p' | 'about'; id: string }[]>([]);
  const open = (t: 'g' | 'p' | 'about', id: string, push = false) => setSheet((s) => (push ? [...s, { t, id }] : [{ t, id }]));
  useEffect(() => setSheet([]), [view]);
  const mi = months.indexOf(month);
  const [y, mo] = month ? month.split('-').map(Number) : [0, 0];

  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Медиа</h1><div className="sub">«Пиши-Делись» по округам 118–129 и активность партийных групп</div></div>
        {view !== 'groups' && view !== 'brief' && month && (
          <div className="month-switch">
            <Button size="sm" iconOnly icon={ChevronLeft} aria-label="Предыдущий месяц" disabled={mi <= 0} onClick={() => setMonth(months[mi - 1])} />
            <span className="pill">{MONTHS_NOM[mo - 1]} {y}</span>
            <Button size="sm" iconOnly icon={ChevronRight} aria-label="Следующий месяц" disabled={mi >= months.length - 1} onClick={() => setMonth(months[mi + 1])} />
          </div>
        )}
        <Button size="sm" icon={Info} onClick={() => open('about', '')}>О рейтинге</Button>
      </div>
      <Tabs value={view} onChange={(v) => go(`/media/${v}`)} tabs={[{ value: 'brief', label: 'Что публикуем' }, { value: 'dash', label: 'Дашборд' }, { value: 'okr', label: 'Округа' }, { value: 'aut', label: 'Авторы' }, { value: 'loose', label: 'Без округа' }, { value: 'idle', label: 'Не пишут' }, { value: 'groups', label: 'Группы ВК и ТГ' }]} />
      {view === 'brief' ? <BriefsView /> : view === 'groups' ? <GroupsView pd={pd.data} /> : pd.error && !pd.data ? (
        <div className="card"><Empty icon={Info} title="Не удалось загрузить данные «Пиши-Делись»" text="Таблица или документ со списком сейчас недоступны. Обновите страницу через пару минут." /></div>
      ) : !A ? <div className="map-skel" style={{ height: 320 }} /> : (
        <>
          <Ticker A={A} month={month} />
          {view === 'dash' && pd.data && <DashView A={A} D={pd.data} month={month} months={months} open={open} />}
          {view === 'okr' && <OkrView A={A} open={open} />}
          {view === 'aut' && <AutView A={A} open={open} />}
          {view === 'loose' && <LooseView A={A} open={open} />}
          {view === 'idle' && <IdleView A={A} open={open} />}
          <p className="small muted" style={{ marginTop: 14 }}>Данные обновляются каждую минуту · выгрузка от {pd.data && new Date(pd.data.updated).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}</p>
        </>
      )}
      {sheet.length > 0 && A && (
        <Drawer open onClose={() => setSheet([])} head={<>{sheet.length > 1 && <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => setSheet((s) => s.slice(0, -1))}>Назад</Button>}</>}>
          {(() => { const top = sheet[sheet.length - 1]; return top.t === 'g' ? <GroupSheet A={A} id={top.id} open={open} /> : top.t === 'p' ? <PersonSheet A={A} i={+top.id} open={open} /> : <About />; })()}
        </Drawer>
      )}
      {sheet.length > 0 && !A && sheet[0].t === 'about' && <Drawer open onClose={() => setSheet([])} head={null}><About /></Drawer>}
    </>
  );
}

function Ticker({ A, month }: { A: Calc; month: string }) {
  const okr = A.groups.filter((g) => g.num > 0).sort((a, b) => b.pts - a.pts)[0];
  const top = A.people.filter((a) => a.posts).sort((a, b) => b.pts - a.pts)[0];
  const roster = A.groups.filter((g) => g.id !== 'none').reduce((s, g) => s + g.roster, 0);
  const writing = A.groups.filter((g) => g.id !== 'none').reduce((s, g) => s + g.mem.filter((a) => a.okPosts).length, 0);
  const contrib = A.people.reduce((s, a) => s + a.contrib, 0);
  const items = [
    okr?.pts ? ['Лидер месяца', okr.label] : null,
    top ? ['Топ-автор', `${top.name} · ${fmt(top.pts)} б.`] : null,
    ['Постов за месяц', fmt(A.P.length)],
    ['Пишут', `${writing} из ${roster}`],
    ['Не пишут', String(roster - writing)],
    ['Вклад в рейтинг региона', fmt(contrib)],
  ].filter(Boolean) as string[][];
  return (
    <div className="ticker solo" aria-label={`Главное за ${month}`}>
      <div className="ticker-track">{[0, 1].map((k) => <span key={k} aria-hidden={k === 1}>{items.map(([a, b]) => <span key={a} className="tk-item">{a}: <b>{b}</b><i>✦</i></span>)}</span>)}</div>
    </div>
  );
}

function Podium({ items }: { items: { key: string; name: string; sub: string; val: string; onClick: () => void }[] }) {
  if (!items.length) return null;
  const order = [items[1], items[0], items[2]];
  return (
    <div className="podium">
      {order.map((it, k) => it ? (
        <button key={it.key} className={`pd p${[2, 1, 3][k]}`} onClick={it.onClick}>
          <span className="pd-rank">{[2, 1, 3][k]}</span>
          <b className="pd-name">{it.name}</b><span className="small muted">{it.sub}</span><span className="pd-val">{it.val}</span>
        </button>
      ) : <span key={k} />)}
    </div>
  );
}
function RankRows({ items, start = 0 }: { items: { key: string; name: string; sub: string; val: string; flag?: string; tip?: string; zero?: boolean; rank?: string; onClick: () => void }[]; start?: number }) {
  return (
    <div className="card rank-list">
      {items.map((it, k) => (
        <button key={it.key} className={`list-item ${it.zero ? 'is-zero' : ''}`} onClick={it.onClick} title={it.tip}>
          <span className="rank">{it.rank ?? start + k + 1}</span>
          <span className="grow"><span className="title ellipsis" style={{ display: 'block' }}>{it.name}{it.flag && <span className="flag">{it.flag}</span>}</span><span className="small muted ellipsis" style={{ display: 'block' }}>{it.sub}</span></span>
          <span className="num rank-val">{it.val}</span>
        </button>
      ))}
    </div>
  );
}
const tipFor = (a: Person) => (!a.bad ? '' : `С невыполненными условиями: ${fmt(a.pts)} б. Без них: ${fmt(a.ptsOk)} б. Не выполнены условия в ${a.bad} ${posts_(a.bad)} из ${a.posts}: ` + [...a.reasons].map(([k, n]) => `${k} — ${n}`).join('; '));
type Opener = (t: 'g' | 'p' | 'about', id: string, push?: boolean) => void;

function OkrView({ A, open }: { A: Calc; open: Opener }) {
  const [m, setM] = useState<'pts' | 'authors' | 'posts'>('pts');
  const okr = A.groups.filter((g) => g.num > 0).sort((a, b) => b[m] - a[m] || b.pts - a.pts || a.num - b.num);
  const all = A.people.filter((a) => a.posts > 0);
  const total = m === 'authors' ? all.length : m === 'posts' ? A.P.length : all.reduce((s, a) => s + a.pts, 0);
  const item = (g: Group) => ({
    key: g.id, name: g.label, onClick: () => open('g', g.id), zero: !g.posts,
    sub: m === 'posts' ? `${fmt(g.pts)} баллов · ${g.authors} из ${g.roster} ${authors_(g.roster)}` : m === 'authors' ? `из ${g.roster} в списке · ${fmt(g.pts)} баллов` : `${g.authors} из ${g.roster} ${authors_(g.roster)} · ${fmt(g.posts)} ${posts_(g.posts)}`,
    val: m === 'authors' ? String(g.authors) : fmt(g[m]),
  });
  const items = okr.map(item);
  const extra = A.groups.filter((g) => !g.num && (g.roster || g.authors)).map((g) => ({ ...item(g), rank: '—' }));
  return (
    <>
      <div className="toolbar"><Segmented label="Показатель" value={m} onChange={setM} options={[{ value: 'pts', label: 'Баллы' }, { value: 'authors', label: 'Авторы' }, { value: 'posts', label: 'Посты' }]} /><span className="spacer" /><span className="pill">{fmt(total)} {m === 'pts' ? 'баллов' : m === 'posts' ? posts_(total) : authors_(total)} по области</span></div>
      <Podium items={items.slice(0, 3)} />
      <RankRows items={items.slice(3)} start={3} />
      {extra.length > 0 && <><h2 className="sec-title">Вне рейтинга округов</h2><RankRows items={extra} /></>}
      <p className="small muted">Нажмите на округ, чтобы увидеть авторов. «Без округа» — авторы из таблицы, которых нет в списке по округам: добавьте их в документ со списком, и их посты засчитаются округу.</p>
    </>
  );
}

function AutView({ A, open }: { A: Calc; open: Opener }) {
  const [m, setM] = useState<'pts' | 'views' | 'posts'>('pts');
  const [src, setSrc] = useState<'all' | Src>('all');
  const [okr, setOkr] = useState('');
  const [q, setQ] = useState('');
  const val = (a: Person, k: 'pts' | 'views' | 'posts') => (src === 'all' ? a[k] : a.src[src]?.[k] ?? 0);
  const list = A.people.filter((a) => a.posts > 0 && val(a, 'posts') > 0 && (!okr || a.g === okr)).sort((a, b) => val(b, m) - val(a, m) || b.pts - a.pts);
  const ranked = list.map((a, k) => ({ a, r: k + 1 })).filter(({ a }) => !q || norm(a.name).includes(norm(q)));
  const item = ({ a, r }: { a: Person; r: number }) => ({ key: String(a.i), name: a.name, rank: String(r), flag: a.bad && src === 'all' ? `!${a.bad}` : '', tip: src === 'all' ? tipFor(a) : '', onClick: () => open('p', String(a.i)),
    sub: `${A.label(a.g)} · ${m === 'posts' ? fmt(val(a, 'pts')) + ' баллов' : val(a, 'posts') + ' ' + posts_(val(a, 'posts'))}`, val: fmt(val(a, m)) });
  return (
    <>
      <div className="toolbar">
        <Segmented label="Соцсеть" value={src} onChange={setSrc} options={[{ value: 'all', label: 'Все' }, ...SRC_ORDER.map((s) => ({ value: s, label: SRC_LABEL[s] }))]} />
        <Segmented label="Показатель" value={m} onChange={setM} options={[{ value: 'pts', label: 'Баллы' }, { value: 'views', label: 'Просмотры' }, { value: 'posts', label: 'Посты' }]} />
      </div>
      <div className="toolbar">
        <select className="select select-sm" value={okr} onChange={(e) => setOkr(e.target.value)} aria-label="Округ"><option value="">Все округа</option>{A.groups.filter((g) => g.roster || g.authors).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select>
        <div className="search-input"><Search size={15} /><input className="input" placeholder="Поиск по имени" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по имени" /></div>
      </div>
      {!ranked.length ? <div className="card"><Empty icon={Search} title={q ? 'Никого не нашли' : 'В этом разделе пока нет постов'} /></div> : q ? <RankRows items={ranked.map(item)} /> : <><Podium items={ranked.slice(0, 3).map(item)} /><RankRows items={ranked.slice(3).map(item)} start={3} /></>}
    </>
  );
}

function LooseView({ A, open }: { A: Calc; open: Opener }) {
  const [m, setM] = useState<'pts' | 'views' | 'posts'>('pts');
  const list = A.groups.find((g) => g.id === 'none')!.mem.filter((a) => a.posts > 0).sort((a, b) => b[m] - a[m] || b.pts - a.pts);
  const item = (a: Person, k: number) => ({ key: String(a.i), name: a.name, rank: String(k + 1), flag: a.bad ? `!${a.bad}` : '', tip: tipFor(a), onClick: () => open('p', String(a.i)), sub: `${a.posts} ${posts_(a.posts)} · ${fmt(a.views)} просмотров`, val: fmt(a[m]) });
  return (
    <>
      <div className="toolbar"><Segmented label="Показатель" value={m} onChange={setM} options={[{ value: 'pts', label: 'Баллы' }, { value: 'views', label: 'Просмотры' }, { value: 'posts', label: 'Посты' }]} /><span className="spacer" /><span className="pill">{list.length} {authors_(list.length)} не привязаны к округу</span></div>
      {!list.length ? <div className="card"><Empty icon={Search} title="Все авторы привязаны к округам" /></div> : <><Podium items={list.slice(0, 3).map(item)} /><RankRows items={list.slice(3).map((a, k) => item(a, k + 3))} start={3} /></>}
      <p className="small muted">Эти авторы пишут посты в «Пиши-Делись», но их нет в документе со списком по округам — их баллы не идут ни одному округу. Впишите человека в нужный округ в документе, и через минуту-две он переедет в рейтинг своего округа.</p>
    </>
  );
}

function IdleView({ A, open }: { A: Calc; open: Opener }) {
  const [okr, setOkr] = useState('');
  const [q, setQ] = useState('');
  const groups = A.groups.filter((g) => g.id !== 'none' && (!okr || g.id === okr));
  const roster = groups.reduce((s, g) => s + g.roster, 0);
  let idleAll = 0;
  const blocks = groups.map((g) => {
    const idle = g.mem.filter((a) => !a.okPosts).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    idleAll += idle.length;
    return { g, idle, shown: q ? idle.filter((a) => norm(a.name).includes(norm(q))) : idle };
  }).filter((b) => b.shown.length);
  return (
    <>
      <div className="toolbar">
        <select className="select select-sm" value={okr} onChange={(e) => setOkr(e.target.value)} aria-label="Округ"><option value="">Все округа</option>{A.groups.filter((g) => g.id !== 'none' && g.roster).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select>
        <div className="search-input"><Search size={15} /><input className="input" placeholder="Поиск по имени" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по имени" /></div>
        <span className="spacer" /><span className="pill pill-ink">Не пишут: {idleAll} из {roster}</span>
      </div>
      {!blocks.length ? <div className="card"><Empty icon={Search} title={q ? 'Никого не нашли' : 'Все в списке пишут посты'} /></div> : blocks.map(({ g, idle, shown }) => (
        <div key={g.id} style={{ marginBottom: 14 }}>
          <h2 className="sec-title">{g.label} · {idle.length} из {g.roster}</h2>
          <RankRows items={shown.map((a) => ({ key: String(a.i), name: a.name, rank: '—', zero: true, tip: tipFor(a), onClick: () => open('p', String(a.i)), sub: a.bad ? `${a.bad} ${posts_(a.bad)} без выполненных условий: ${[...a.reasons.keys()].join(', ')}` : 'нет постов в этом месяце', val: '' }))} />
        </div>
      ))}
      <p className="small muted">Люди из списка по округам, у которых за месяц нет ни одного поста со статусом «Выполнены». Посты с невыполненными условиями засчитываются в баллы, но человек остаётся здесь, пока у него нет ни одного засчитанного поста.</p>
    </>
  );
}

export function PostCard({ p }: { p: Post }) {
  return (
    <article className="post-card">
      <div className="row" style={{ alignItems: 'flex-start' }}><SrcIcon s={p[3]} /><div className="grow"><b className="post-title">{p[1] || 'Без заголовка'}</b><div className="small muted">{p[2]} · {p[0].split('-').reverse().join('.')}</div></div>{p[12] && <a className="btn btn-ghost btn-sm" href={p[12]} target="_blank" rel="noreferrer"><ExternalLink size={14} />Открыть</a>}</div>
      {!counted(p) && <div className="callout danger small" style={{ marginTop: 8 }}>Критерии не выполнены{p[14] ? `: ${p[14]}` : ''}</div>}
      <div className="row small muted" style={{ marginTop: 8, gap: 14 }}><span className="row" style={{ gap: 4 }}><Heart size={13} />{fmt(p[8])}</span><span className="row" style={{ gap: 4 }}><Eye size={13} />{fmt(p[7])}</span><b className="num" style={{ marginLeft: 'auto', color: 'var(--text)' }}>{fmt(p[5])} б.</b></div>
    </article>
  );
}
const Stat = ({ v, t }: { v: string; t: string }) => <div className="mstat"><b>{v}</b><span>{t}</span></div>;

function GroupSheet({ A, id, open }: { A: Calc; id: string; open: Opener }) {
  const g = A.groups.find((x) => x.id === id);
  if (!g) return <Empty icon={Info} title="Нет данных" />;
  const mem = g.mem.filter((a) => id !== 'none' || a.posts > 0).sort((a, b) => b.pts - a.pts || b.posts - a.posts || a.name.localeCompare(b.name, 'ru'));
  return (
    <>
      <h1 style={{ fontSize: 30 }}>{g.label}</h1>
      {/^\d+$/.test(id) && <button className="btn btn-sm btn-secondary" style={{ marginTop: 10 }} onClick={() => go(`/team/districts/${id}`)}>Страница округа в Командном центре</button>}
      <div className="mstats"><Stat v={fmt(g.pts)} t="баллов" /><Stat v={fmt(g.posts)} t={posts_(g.posts)} /><Stat v={id === 'none' ? String(g.authors) : `${g.authors} из ${g.roster}`} t="авторов с постами" /><Stat v={fmt(g.views)} t="просмотров" /></div>
      <RankRows items={mem.map((a, k) => ({ key: String(a.i), name: a.name, rank: a.posts ? String(k + 1) : '—', zero: !a.posts, flag: a.bad ? `!${a.bad}` : '', tip: tipFor(a), onClick: () => open('p', String(a.i), true), sub: a.posts ? `${a.posts} ${posts_(a.posts)} · ${fmt(a.views)} просмотров` : 'нет постов в этом месяце', val: a.posts ? fmt(a.pts) : '' }))} />
    </>
  );
}
function PersonSheet({ A, i, open }: { A: Calc; i: number; open: Opener }) {
  const a = A.people[i];
  if (!a) return <Empty icon={Info} title="Нет данных" />;
  const mine = A.P.filter((p) => p[4] === i).sort((x, y) => (y[0] > x[0] ? 1 : y[0] < x[0] ? -1 : y[5] - x[5]));
  const place = A.people.filter((x) => x.posts > 0).sort((x, y) => y.pts - x.pts).indexOf(a) + 1;
  const [limit, setLimit] = useState(30);
  useEffect(() => setLimit(30), [i]);
  return (
    <>
      <h1 style={{ fontSize: 30 }}>{a.name}</h1>
      <div className="row wrap" style={{ marginTop: 10 }}><button className="pill" onClick={() => open('g', a.g, true)}>{A.label(a.g)}</button>{place > 0 && <span className="pill pill-ink">{place} место в области</span>}</div>
      <div className="mstats"><Stat v={fmt(a.pts)} t={a.bad ? 'баллов с невыполненными' : 'баллов'} />{a.bad > 0 && <Stat v={fmt(a.ptsOk)} t="баллов без них" />}<Stat v={fmt(a.posts)} t={posts_(a.posts)} /><Stat v={fmt(a.views)} t="просмотров" /><Stat v={fmt(a.likes)} t="лайков" /></div>
      {a.bad > 0 && <div className="callout danger" style={{ marginBottom: 12 }}><span><b>Не выполнены условия в {a.bad} {posts_(a.bad)} · {fmt(a.ptsBad)} б.</b><br />{[...a.reasons].map(([k, n]) => `${k} — ${n}`).join('; ')}</span></div>}
      <div className="row wrap" style={{ marginBottom: 12 }}>{SRC_ORDER.filter((s) => a.src[s]?.posts).map((s) => <span key={s} className="pill"><SrcIcon s={s} />{a.src[s]!.posts} · {fmt(a.src[s]!.pts)} б.</span>)}</div>
      {mine.length ? <div className="col">{mine.slice(0, limit).map((p, k) => <PostCard key={k} p={p} />)}{mine.length > limit && <Button onClick={() => setLimit(limit + 30)}>Показать ещё ({mine.length - limit})</Button>}</div> : <Empty icon={Info} title="В этом месяце постов нет" />}
    </>
  );
}
function About() {
  const f: [Src, string, [string, string][]][] = [
    ['tg', 'Telegram', [['база', '1 балл'], ['каждые 50 просмотров', '+1 балл'], ['реакция', '+1.2 балла'], ['комментарий', '+5 баллов'], ['репост', '+5 баллов']]],
    ['vk', 'ВКонтакте', [['база', '1 балл'], ['каждые 50 просмотров', '+0.7 балла'], ['лайк', '+1 балл'], ['комментарий', '+5 баллов'], ['репост', '+5 баллов']]],
    ['youtube', 'YouTube Shorts', [['база', '1 балл'], ['каждые 50 просмотров', '+0.75 балла'], ['лайк', '+0.5 балла'], ['комментарий', '+5 баллов']]],
    ['tiktok', 'TikTok', [['база', '1 балл'], ['каждые 50 просмотров', '+0.5 балла'], ['лайк', '+0.5 балла'], ['комментарий', '+5 баллов'], ['репост', '+6 баллов'], ['сохранение', '+3 балла']]],
    ['instagram', 'Reels', [['база', '1 балл'], ['каждые 50 просмотров', '+0.75 балла'], ['лайк', '+0.5 балла'], ['комментарий', '+5 баллов']]],
  ];
  return (
    <div className="col" style={{ gap: 12 }}>
      <h1 style={{ fontSize: 30 }}>О рейтинге</h1>
      <p style={{ margin: 0 }}>Статистика «Пиши-Делись» по Московской области: рейтинг округов 118–129 и авторов. Посты — из выгрузки «Пиши-Делись» (Google-таблица), принадлежность авторов к округам — из документа со списком. Посты со вкладки «Невыполнены условия» тоже идут в баллы; у таких людей стоит значок «!N». Данные обновляются каждую минуту.</p>
      <h2>Как считаются баллы</h2>
      <div className="card table-wrap"><table className="tbl"><tbody>{f.map(([k, t, r]) => [<tr key={k}><th colSpan={2}><span className="row"><SrcIcon s={k} />{t}</span></th></tr>, ...r.map((x) => <tr key={k + x[0]}><td>{x[0]}</td><td className="right">{x[1]}</td></tr>)])}</tbody></table></div>
      <p style={{ margin: 0 }}>Затем балл умножается на коэффициент: оригинальный пост × 1.5, неоригинальный × 1.2, репост × 1.</p>
      <p style={{ margin: 0 }}><b>Вклад в рейтинг региона</b> — сумма колонки «Вклад в регион»: так считается балл Московской области в федеральном рейтинге (сумма баллов / число избирателей × 10 000).</p>
    </div>
  );
}

/* ───────── Группы ВК и Telegram: когда был последний пост ───────── */
function chState(ch: Channel | null) {
  if (!ch) return { cls: 'none', txt: 'нет группы', days: null as number | null };
  if (ch.status === 'nokey') return { cls: 'none', txt: 'нужен ключ ВК', days: null };
  if (ch.status === 'closed') return { cls: 'none', txt: 'лента закрыта', days: null };
  if (ch.status === 'error') return { cls: 'none', txt: 'не проверить', days: null };
  if (ch.status === 'empty' || !ch.last) return { cls: 'bad', txt: 'постов нет', days: Infinity };
  const msk = (t: number) => new Date(t + 3 * 3600e3).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(msk(Date.now())) - Date.parse(msk(Date.parse(ch.last)))) / 864e5);
  const d = msk(Date.parse(ch.last)).split('-').reverse().join('.');
  const txt = days <= 0 ? 'сегодня' : days === 1 ? 'вчера' : days <= 30 ? `${days} ${plural(days, ['день', 'дня', 'дней'])} назад` : `молчит с ${d}`;
  return { cls: days <= 1 ? 'fresh' : days <= 3 ? 'warn' : 'bad', txt, days };
}
function GroupsView({ pd }: { pd: PdData | null }) {
  const G = useJson<GroupsData>('media-groups', 5 * 60000);
  const [net, setNet] = useState<'all' | 'vk' | 'tg'>('all');
  const [sort, setSort] = useState<'worst' | 'okr'>('worst');
  const [okr, setOkr] = useState('');
  const [q, setQ] = useState('');
  if (!G.data) return G.error ? <div className="card"><Empty icon={Info} title="Не удалось проверить группы" text="Попробуйте обновить страницу чуть позже." /></div> : <div className="map-skel" style={{ height: 320 }} />;
  const okrName = (o: string) => (/^мо$/i.test(o) ? 'Региональные группы' : pd?.groups.find((x) => x.id === o) ? `${o} ${pd.groups.find((x) => x.id === o)!.name}` : o ? `${o} округ` : 'Без округа');
  const nets: ('vk' | 'tg')[] = net === 'all' ? ['vk', 'tg'] : [net];
  const items = G.data.groups
    .filter((g) => (!okr || g.okrug === okr) && (!q || norm(`${g.city} ${g.coord} ${g.resp}`).includes(norm(q))) && (net === 'all' || g[net]))
    .map((g) => {
      const st = nets.map((n) => [n, chState(g[n])] as const);
      const known = st.filter(([, x]) => x.days !== null);
      const worst = known.length ? Math.max(...known.map(([, x]) => x.days as number)) : -1;
      return { g, st, worst, cls: !known.length ? 'none' : worst <= 1 ? 'fresh' : worst <= 3 ? 'warn' : 'bad' };
    });
  const cnt = { fresh: 0, warn: 0, bad: 0, none: 0 } as Record<string, number>;
  items.forEach((it) => it.st.forEach(([n, x]) => { if (it.g[n] || net !== 'all') cnt[x.cls]++; }));
  const order: Record<string, number> = { bad: 0, warn: 1, fresh: 2, none: 3 };
  const card = (it: (typeof items)[number]) => (
    <div key={it.g.okrug + it.g.city} className="gcard">
      <span className={`sdot ${it.cls}`} />
      <div className="grow">
        <div className="row wrap"><b>{it.g.city}</b><span className="small muted">{[sort === 'worst' ? okrName(it.g.okrug) : '', it.g.resp ? `отв.: ${it.g.resp}` : '', it.g.coord && it.g.coord !== '-' ? `коорд.: ${it.g.coord}` : ''].filter(Boolean).join(' · ')}</span></div>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {it.st.map(([n, x]) => { const ch = it.g[n]; const href = ch && (ch.url || ch.link); return href ? <a key={n} className={`gb ${x.cls}`} href={href} target="_blank" rel="noreferrer"><SrcIcon s={n} />{x.txt}</a> : <span key={n} className={`gb ${x.cls}`}><SrcIcon s={n} />{x.txt}</span>; })}
        </div>
        {it.st.some(([n]) => it.g[n]?.about) && <div className="gabout">{it.st.filter(([n]) => it.g[n]?.about).map(([n]) => <p key={n}><SrcIcon s={n} />{it.g[n]!.about}</p>)}</div>}
      </div>
    </div>
  );
  return (
    <>
      <div className="toolbar">
        <Segmented label="Сеть" value={net} onChange={setNet} options={[{ value: 'all', label: 'ВК и Telegram' }, { value: 'vk', label: 'ВКонтакте' }, { value: 'tg', label: 'Telegram' }]} />
        <Segmented label="Порядок" value={sort} onChange={setSort} options={[{ value: 'worst', label: 'Давно молчат' }, { value: 'okr', label: 'По округам' }]} />
      </div>
      <div className="toolbar">
        <select className="select select-sm" value={okr} onChange={(e) => setOkr(e.target.value)} aria-label="Округ"><option value="">Все округа</option>{[...new Set(G.data.groups.map((g) => g.okrug))].map((o) => <option key={o} value={o}>{okrName(o)}</option>)}</select>
        <div className="search-input"><Search size={15} /><input className="input" placeholder="Город или человек" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по городу или человеку" /></div>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}><span className="badge st-done">Свежие (0–1 день): {cnt.fresh}</span><span className="badge st-review">2–3 дня: {cnt.warn}</span><span className="badge st-overdue">Молчат 4+ дней: {cnt.bad}</span><span className="badge badge-soft">Нет данных: {cnt.none}</span></div>
      {!items.length ? <div className="card"><Empty icon={Search} title="Ничего не нашли" /></div> : sort === 'worst'
        ? <div className="card gcards">{[...items].sort((a, b) => order[a.cls] - order[b.cls] || b.worst - a.worst || a.g.city.localeCompare(b.g.city, 'ru')).map(card)}</div>
        : [...new Set(items.map((it) => it.g.okrug))].map((o) => <div key={o} style={{ marginBottom: 14 }}><h2 className="sec-title">{okrName(o)}</h2><div className="card gcards">{items.filter((it) => it.g.okrug === o).map(card)}</div></div>)}
      <p className="small muted">Сколько дней назад в группе был последний пост (закреплённые не считаются). Зелёный — сегодня или вчера, жёлтый — 2–3 дня, красный — 4 дня и больше. Нажмите на метку, чтобы открыть пост. Список групп берётся из таблицы, проверка — раз в 15 минут.{!G.data.vkEnabled && <b> ВКонтакте пока не проверяется: нужен сервисный ключ ВК (секрет VK_TOKEN в Supabase).</b>}</p>
    </>
  );
}

/* ───────── Дашборд месяца ───────── */
const SRC_COLOR: Record<Src, string> = { vk: '#2c76e6', tg: '#229ed9', youtube: '#e53935', tiktok: '#121514', instagram: '#c13584', other: '#8a918e' };
function DashView({ A, D, month, months, open }: { A: Calc; D: PdData; month: string; months: string[]; open: Opener }) {
  const prevM = months[months.indexOf(month) - 1];
  const B = useMemo(() => (prevM ? compute(D, prevM) : null), [D, prevM]);
  const G = useJson<GroupsData>('media-groups', 5 * 60000);
  const sum = (C: Calc) => {
    const act = C.people.filter((a) => a.posts > 0);
    const roster = C.groups.filter((g) => g.id !== 'none').reduce((s, g) => s + g.roster, 0);
    const writing = C.groups.filter((g) => g.id !== 'none').reduce((s, g) => s + g.mem.filter((a) => a.okPosts).length, 0);
    return { posts: C.P.length, pts: act.reduce((s, a) => s + a.pts, 0), authors: act.length, views: act.reduce((s, a) => s + a.views, 0), contrib: act.reduce((s, a) => s + a.contrib, 0), writingShare: roster ? writing / roster : 0, writing, roster };
  };
  const cur = sum(A), prev = B ? sum(B) : null;
  const delta = (a: number, b?: number) => {
    if (b === undefined) return null;
    const d = b ? (a - b) / b : Infinity;
    // при почти пустом прошлом месяце процент бессмысленен — показываем саму цифру
    if (!Number.isFinite(d) || Math.abs(d) > 3) return <span>в прошлом месяце — {fmt(b)}</span>;
    return <span className={d >= 0 ? 'delta-up' : 'delta-down'}>{d >= 0 ? '+' : ''}{Math.round(d * 100)}% к прошлому месяцу</span>;
  };
  const okr = A.groups.filter((g) => g.num > 0);
  const maxPts = Math.max(1, ...okr.map((g) => g.pts));
  const shares = okr.map((g) => ({ g, w: g.mem.filter((a) => a.okPosts).length, share: g.roster ? g.mem.filter((a) => a.okPosts).length / g.roster : 0 })).sort((a, b) => b.share - a.share);
  // по дням
  const [y, mo] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const daily = Array.from({ length: days }, (_, d) => ({ d: d + 1, posts: 0, pts: 0 }));
  A.P.forEach((p) => { const d = +p[0].slice(8, 10); if (daily[d - 1]) { daily[d - 1].posts++; daily[d - 1].pts += p[5]; } });
  const maxDay = Math.max(1, ...daily.map((x) => x.posts));
  // соцсети
  const bySrc = SRC_ORDER.concat('other' as Src).map((sname) => ({ s: sname, posts: A.P.filter((p) => p[3] === sname).length, pts: A.P.filter((p) => p[3] === sname).reduce((t, p) => t + p[5], 0) })).filter((x) => x.posts);
  const top = A.people.filter((a) => a.posts).sort((a, b) => b.pts - a.pts).slice(0, 5);
  const gStat = G.data ? (() => {
    const c = { fresh: 0, warn: 0, bad: 0, none: 0 } as Record<string, number>;
    const silent = new Map<string, number>();
    G.data.groups.forEach((g) => (['vk', 'tg'] as const).forEach((n) => { if (!g[n]) return; const st = chState(g[n]); c[st.cls]++; if (st.cls === 'bad') silent.set(g.okrug, (silent.get(g.okrug) ?? 0) + 1); }));
    return { c, silent: [...silent].sort((a, b) => b[1] - a[1]).slice(0, 5) };
  })() : null;
  const Tile = ({ label, value, foot }: { label: string; value: string; foot?: React.ReactNode }) => <div className="kpi" style={{ cursor: 'default' }}><span className="kpi-label">{label}</span><span className="kpi-value">{value}</span><span className="kpi-foot">{foot}</span></div>;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid dash-tiles">
        <Tile label="Посты" value={fmt(cur.posts)} foot={delta(cur.posts, prev?.posts)} />
        <Tile label="Баллы" value={fmt(cur.pts)} foot={delta(cur.pts, prev?.pts)} />
        <Tile label="Авторы с постами" value={fmt(cur.authors)} foot={delta(cur.authors, prev?.authors)} />
        <Tile label="Пишут из списка" value={`${Math.round(cur.writingShare * 100)}%`} foot={`${cur.writing} из ${cur.roster} человек`} />
        <Tile label="Просмотры" value={fmt(cur.views)} foot={delta(cur.views, prev?.views)} />
        <Tile label="Вклад в рейтинг региона" value={fmt(cur.contrib)} foot={delta(cur.contrib, prev?.contrib)} />
      </div>
      <div className="grid g-main">
        <div className="card">
          <div className="card-head"><h2 className="grow">Баллы по округам</h2><span className="small muted">нажмите на округ</span></div>
          <div className="card-body"><MoMap values={Object.fromEntries(okr.map((g) => [g.id, g.posts ? (g.pts / maxPts) * 1.1 : null]))} onPick={(id) => open('g', id)} caption="баллы: меньше → больше" tip={(id) => { const g = okr.find((x) => x.id === id); return g ? `${fmt(g.pts)} баллов · ${g.posts} ${posts_(g.posts)}` : 'нет данных'; }} /></div>
        </div>
        <div className="card">
          <div className="card-head"><h2 className="grow">Доля пишущих</h2><span className="small muted">из списка округа</span></div>
          <div className="card-body col" style={{ gap: 2 }}>
            {shares.map(({ g, w, share }) => (
              <button key={g.id} className="share-row" onClick={() => open('g', g.id)}>
                <span className="ellipsis">{g.label}</span><Bar value={share} tone="ok" /><span className="num">{Math.round(share * 100)}%</span><span className="small muted nowrap">{w}/{g.roster}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2 className="grow">Посты по дням</h2><span className="small muted">{MONTHS_NOM[mo - 1]} {y}</span></div>
        <div className="card-body">
          <div className="daily" role="img" aria-label="Количество постов по дням месяца">
            {daily.map((x) => <div key={x.d} className="daily-col" title={`${x.d} число: ${x.posts} ${posts_(x.posts)}, ${fmt(x.pts)} баллов`}><span className="daily-bar" style={{ height: `${(x.posts / maxDay) * 100}%` }} /><span className="daily-d">{x.d % 5 === 0 || x.d === 1 ? x.d : ''}</span></div>)}
          </div>
        </div>
      </div>
      <div className="grid g-3">
        <div className="card">
          <div className="card-head"><h2>Соцсети</h2></div>
          <div className="card-body">
            <div className="stack" style={{ height: 14, marginBottom: 12 }}>{bySrc.map((x) => <i key={x.s} style={{ width: `${(x.posts / Math.max(1, cur.posts)) * 100}%`, background: SRC_COLOR[x.s] }} />)}</div>
            {bySrc.sort((a, b) => b.posts - a.posts).map((x) => <div key={x.s} className="row" style={{ padding: '5px 0' }}><SrcIcon s={x.s} /><span className="grow">{SRC_LABEL[x.s]}</span><span className="small muted">{Math.round((x.posts / Math.max(1, cur.posts)) * 100)}%</span><b className="num" style={{ minWidth: 54, textAlign: 'right' }}>{fmt(x.posts)}</b></div>)}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Топ-5 авторов</h2></div>
          <div className="card-body" style={{ padding: '6px 0' }}>
            {top.map((a, k) => <button key={a.i} className="list-item" onClick={() => open('p', String(a.i))}><span className="rank">{k + 1}</span><span className="grow"><span className="title ellipsis" style={{ display: 'block' }}>{a.name}</span><span className="small muted">{A.label(a.g)}</span></span><span className="num">{fmt(a.pts)}</span></button>)}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2 className="grow">Группы ВК и ТГ</h2><button className="btn btn-ghost btn-sm" onClick={() => go('/media/groups')}>Все</button></div>
          <div className="card-body">
            {!gStat ? <div className="map-skel" style={{ height: 120 }} /> : (
              <>
                <div className="row wrap" style={{ marginBottom: 10 }}><span className="badge st-done">свежие: {gStat.c.fresh}</span><span className="badge st-review">2–3 дня: {gStat.c.warn}</span><span className="badge st-overdue">молчат 4+: {gStat.c.bad}</span></div>
                <div className="small muted" style={{ marginBottom: 4 }}>Где больше всего молчащих групп</div>
                {gStat.silent.length ? gStat.silent.map(([o, n]) => <div key={o} className="row" style={{ padding: '4px 0' }}><span className="grow">{A.label(o) || (o === 'МО' ? 'Региональные' : o)}</span><b className="num">{n}</b></div>) : <span className="small muted">Молчащих групп нет</span>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
