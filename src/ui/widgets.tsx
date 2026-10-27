import { ExternalLink, FileText, Image as ImageIcon, Link2, Paperclip, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BACKEND } from '../lib/supabase';
import { signedUrl, STORAGE_PREFIX, uploadFile } from '../data/backend';
import { isOverdue, type TrendPoint } from '../data/calc';
import { getState, setUi, uid, useAppState } from '../data/store';
import type { Attachment, Task, User } from '../data/types';
import { ROLE_LABEL } from '../data/types';
import { fmtDate, fmtDayMonth, PERIOD_OPTIONS, type PeriodKey } from '../lib/date';
import { useLookup, useMe } from './hooks';
import { openRecords, openTask, useGlobal } from './global';
import { Avatar, Button, Empty, Modal, PriorityTag, TaskStatusBadges, toast } from './kit';
import { isManager } from '../data/perm';

/* ───────── Контекст экрана: период и округ ───────── */
export function ContextBar({ showDistrict = true }: { showDistrict?: boolean }) {
  const s = useAppState();
  const me = useMe();
  const lockDistrict = !isManager(me) && me.districtId;
  return (
    <div className="row wrap ctx-bar" style={{ gap: 8 }}>
      <label className="sr-only" htmlFor="ctx-period">Период</label>
      <select id="ctx-period" className="select select-sm" style={{ width: 170 }} value={s.ui.period} onChange={(e) => setUi({ period: e.target.value as PeriodKey })}>
        {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {showDistrict && (
        <>
          <label className="sr-only" htmlFor="ctx-district">Округ</label>
          <select id="ctx-district" className="select select-sm" style={{ width: 170 }} value={lockDistrict ? me.districtId! : s.ui.districtId} disabled={!!lockDistrict} onChange={(e) => setUi({ districtId: e.target.value })} title={lockDistrict ? 'Вы видите данные своего округа' : undefined}>
            <option value="all">Все округа</option>
            {s.districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </>
      )}
    </div>
  );
}
/** Округ, выбранный в контексте (для координатора и участника — всегда свой). */
export function useScopeDistrict() {
  const s = useAppState();
  const me = useMe();
  if (!isManager(me) && me.districtId) return me.districtId;
  return s.ui.districtId === 'all' ? null : s.ui.districtId;
}

/* ───────── Расшифровка любой сводной цифры ───────── */
export function RecordsModal() {
  const g = useGlobal();
  const L = useLookup();
  const r = g.records;
  return (
    <Modal open={!!r} onClose={() => openRecords(null)} title={r?.title ?? ''} width={860}>
      {r && (
        <>
          {r.rule && <div className="callout info" style={{ marginBottom: 12 }}><FileText size={16} style={{ flex: 'none', marginTop: 2 }} /><span><b>Как считается:</b> {r.rule}</span></div>}
          <div className="muted small" style={{ marginBottom: 8 }}>Записей: {r.tasks.length}. Нажмите на строку, чтобы открыть исходную задачу.</div>
          {r.tasks.length === 0 ? (
            <Empty icon={Search} title="Нет записей" text="За выбранный период в эту цифру ничего не попало. Попробуйте выбрать другой период или округ." />
          ) : (
            <div className="card table-wrap" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <table className="tbl tbl-cards">
                <thead><tr><th>Задача</th><th>Округ</th><th>Ответственный</th><th>Срок</th><th>Статус</th>{r.cellValue && <th className="right">Значение</th>}</tr></thead>
                <tbody>
                  {r.tasks.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => openTask(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTask(t.id)}>
                      <td className="t-title"><span className="ellipsis">{t.title}</span></td>
                      <td className="nowrap">{L.dname(t.districtId)}</td>
                      <td className="nowrap"><span className="row"><Avatar user={L.user(t.assigneeId)} size={22} />{L.user(t.assigneeId)?.name}</span></td>
                      <td className={`nowrap ${isOverdue(t) ? 'overdue-text' : ''}`}>{fmtDate(t.due)}</td>
                      <td><TaskStatusBadges t={t} /></td>
                      {r.cellValue && <td className="right num">{r.cellValue(t)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* ───────── Компактная строка задачи ───────── */
export function TaskRow({ t, right }: { t: Task; right?: React.ReactNode }) {
  const L = useLookup();
  return (
    <button className="list-item" onClick={() => openTask(t.id)}>
      <Avatar user={L.user(t.assigneeId)} size={30} />
      <div className="grow">
        <div className="title ellipsis">{t.title}</div>
        <div className="small muted row" style={{ gap: 6 }}>
          <span className="ellipsis">{L.dname(t.districtId)} · {L.user(t.assigneeId)?.name}</span>
        </div>
      </div>
      {right ?? (
        <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
          <TaskStatusBadges t={t} />
          <span className={`small ${isOverdue(t) ? 'overdue-text' : 'muted'}`}>до {fmtDayMonth(t.due)}</span>
        </div>
      )}
    </button>
  );
}

/* ───────── Обводка «от руки», как в логотипе ───────── */
export function Scribble() {
  return (
    <svg className="scribble-svg" viewBox="0 0 220 90" preserveAspectRatio="none" aria-hidden>
      <path d="M126 82C92 88 34 86 14 66 -6 46 22 18 74 10 126 2 192 8 208 30 222 50 196 70 150 78 120 83 92 84 70 82" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/* ───────── Картограмма Московской области ───────── */
// Границы 56 городских округов (ТИК, © участники OpenStreetMap), цвет — по избирательному округу 118–129.
interface MapFeature { tik: string; city: string; okrug: string; label: [number, number]; polygons: number[][][][] }
interface MapGeo { bbox: [number, number, number, number]; features: MapFeature[] }
let geoCache: Promise<MapGeo | null> | null = null;
const loadGeo = () => (geoCache ??= fetch(`${import.meta.env.BASE_URL}mo-map.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));

export function MoMap({ values, onPick, dark, height }: { values: Record<string, number | null>; onPick: (id: string) => void; dark?: boolean; height?: number }) {
  const s = useAppState();
  const [geo, setGeo] = useState<MapGeo | null | undefined>(undefined);
  const [hover, setHover] = useState<{ f: MapFeature; x: number; y: number } | null>(null);
  useEffect(() => { loadGeo().then(setGeo); }, []);
  const proj = useMemo(() => {
    if (!geo) return null;
    const [minX, minY, maxX, maxY] = geo.bbox;
    const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
    const W = 1000, scale = W / ((maxX - minX) * k), H = Math.round((maxY - minY) * scale);
    const pt = ([x, y]: number[]) => `${((x - minX) * k * scale).toFixed(1)},${((maxY - y) * scale).toFixed(1)}`;
    const paths = geo.features.map((f) => ({ f, d: f.polygons.map((poly) => poly.map((ring) => 'M' + ring.map(pt).join('L') + 'Z').join('')).join('') }));
    // подписи округов — в среднем центре их городов
    const centers = new Map<string, [number, number, number]>();
    geo.features.forEach((f) => { const [x, y] = pt(f.label).split(',').map(Number); const c = centers.get(f.okrug) ?? [0, 0, 0]; centers.set(f.okrug, [c[0] + x, c[1] + y, c[2] + 1]); });
    return { W, H, paths, centers: [...centers].map(([id, [x, y, n]]) => ({ id, x: x / n, y: y / n })) };
  }, [geo]);
  if (geo === undefined) return <div className="map-skel" style={{ height: height ?? 260 }} />;
  if (!geo || !proj) return <div className="small muted">Границы округов не загрузились — обновите страницу.</div>;
  const fill = (v: number | null | undefined) => {
    if (v === null || v === undefined) return dark ? 'rgba(255,255,255,.10)' : '#e4e8e7';
    const t = Math.max(0, Math.min(1, v / 1.1));
    // светлый бирюзовый → насыщенный бирюзовый
    const a = [214, 244, 240], b = [11, 150, 140];
    return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * t)).join(',')})`;
  };
  const dname = (id: string) => { const d = s.districts.find((x) => x.id === id); return d ? `${d.num ?? ''} ${d.name}`.trim() : id; };
  return (
    <div className="mo-map" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${proj.W} ${proj.H}`} role="img" aria-label="Картограмма Московской области по избирательным округам" style={height ? { height } : undefined}>
        {proj.paths.map(({ f, d }) => (
          <path key={f.tik} d={d} fill={fill(values[f.okrug])} fillRule="evenodd" stroke={dark ? '#0b1614' : '#fff'} strokeWidth="1.2" tabIndex={0} role="button"
            className={`map-unit ${hover && hover.f.okrug === f.okrug ? 'hl' : ''}`} aria-label={`${f.city}, округ ${dname(f.okrug)}`}
            onMouseMove={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setHover({ f, x: e.clientX - r.left, y: e.clientY - r.top }); }}
            onFocus={() => setHover({ f, x: 20, y: 20 })} onClick={() => onPick(f.okrug)} onKeyDown={(e) => e.key === 'Enter' && onPick(f.okrug)} />
        ))}
        {proj.centers.map((c) => <text key={c.id} x={c.x} y={c.y} className={`map-num ${dark ? 'dark' : ''}`} textAnchor="middle" dominantBaseline="middle">{c.id}</text>)}
      </svg>
      {hover && (
        <div className="map-tip" style={{ left: Math.min(hover.x + 12, 220), top: hover.y + 12 }}>
          <b>{hover.f.city}</b><span>округ {dname(hover.f.okrug)}</span>
          <span>план: {values[hover.f.okrug] === null || values[hover.f.okrug] === undefined ? 'нет данных' : Math.round((values[hover.f.okrug] ?? 0) * 100) + '%'}</span>
        </div>
      )}
      <div className="map-legend"><i style={{ background: fill(0.1) }} /><i style={{ background: fill(0.5) }} /><i style={{ background: fill(0.8) }} /><i style={{ background: fill(1.1) }} /><span>выполнение плана: меньше → больше</span><i style={{ background: fill(null) }} /><span>нет задач</span></div>
    </div>
  );
}

/* ───────── Графики ───────── */
export function TrendChart({ data, onPick }: { data: TrendPoint[]; onPick?: (p: TrendPoint) => void }) {
  const W = 640, H = 210, pl = 30, pr = 36, pt = 12, pb = 26;
  const maxV = Math.max(4, ...data.map((d) => Math.max(d.assigned, d.confirmed)));
  const iw = W - pl - pr, ih = H - pt - pb;
  const bw = iw / data.length;
  const y = (v: number) => pt + ih - (v / maxV) * ih;
  const yp = (p: number) => pt + ih - Math.min(p, 1.2) / 1.2 * ih;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${pl + bw * i + bw / 2},${yp(d.plan)}`).join(' ');
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Динамика по неделям">
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={pl} x2={W - pr} y1={pt + ih * (1 - f)} y2={pt + ih * (1 - f)} stroke="#e7eeec" /><text x={pl - 6} y={pt + ih * (1 - f) + 4} textAnchor="end">{Math.round(maxV * f)}</text></g>)}
        <text x={W - pr + 6} y={yp(1) + 4}>100%</text>
        <line x1={pl} x2={W - pr} y1={yp(1)} y2={yp(1)} stroke="#0b3b37" strokeDasharray="3 4" opacity=".35" />
        {data.map((d, i) => {
          const x = pl + bw * i;
          return (
            <g key={d.from} style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => onPick?.(d)}>
              <rect x={x + bw * 0.18} y={y(d.assigned)} width={bw * 0.3} height={pt + ih - y(d.assigned)} rx="3" fill="#d9f3ef" />
              <rect x={x + bw * 0.5} y={y(d.confirmed)} width={bw * 0.3} height={pt + ih - y(d.confirmed)} rx="3" fill="#087e74" />
              <text x={x + bw / 2} y={H - 8} textAnchor="middle">{fmtDayMonth(d.from)}</text>
              <rect x={x} y={pt} width={bw} height={ih} fill="transparent"><title>{`Неделя с ${fmtDayMonth(d.from)}: назначено ${d.assigned}, подтверждено ${d.confirmed}, план ${Math.round(d.plan * 100)}%`}</title></rect>
            </g>
          );
        })}
        <path d={line} fill="none" stroke="#26aea1" strokeWidth="2.5" strokeLinejoin="round" />
        {data.map((d, i) => <circle key={i} cx={pl + bw * i + bw / 2} cy={yp(d.plan)} r="3.5" fill="#fff" stroke="#26aea1" strokeWidth="2" />)}
      </svg>
      <div className="legend"><span><i style={{ background: '#d9f3ef' }} />Назначено (по сроку)</span><span><i style={{ background: '#087e74' }} />Подтверждено</span><span><i style={{ background: '#26aea1', height: 3 }} />Выполнение плана, %</span></div>
    </div>
  );
}

export function HBars({ rows }: { rows: { id: string; label: string; value: number | null; text: string; onClick: () => void }[] }) {
  return (
    <div>
      {rows.map((r) => {
        const v = r.value ?? 0;
        return (
          <button key={r.id} className="hbar-row" onClick={r.onClick}>
            <span className="ellipsis" style={{ fontWeight: 600 }}>{r.label}</span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ display: 'block', width: `${Math.min(v / 1.2, 1) * 100}%`, background: r.value === null ? '#cbd6d3' : v >= 0.8 ? '#087e74' : v >= 0.5 ? '#e3a23b' : '#d9534f' }} />
              <span className="hbar-target" style={{ left: `${100 / 1.2}%` }} aria-hidden />
            </span>
            <span className="num right" style={{ fontSize: 14 }}>{r.text}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────── Выбор людей ───────── */
export function PeoplePicker({ value, onChange, users, label = 'Участники' }: { value: string[]; onChange: (v: string[]) => void; users: User[]; label?: string }) {
  const [q, setQ] = useState('');
  const L = useLookup();
  const list = useMemo(() => users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase())), [users, q]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="card" style={{ borderRadius: 12 }}>
      <div className="row" style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <Search size={15} className="muted" />
        <input className="input input-sm" style={{ border: 0, boxShadow: 'none' }} placeholder="Найти человека" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`${label}: поиск`} />
        <span className="small muted nowrap">выбрано {value.length}</span>
      </div>
      <div style={{ maxHeight: 190, overflowY: 'auto', padding: '4px 8px' }}>
        {list.map((u) => (
          <label key={u.id} className="check" style={{ display: 'flex', padding: '5px 4px' }}>
            <input type="checkbox" checked={value.includes(u.id)} onChange={() => toggle(u.id)} />
            <Avatar user={u} size={22} />
            <span className="grow ellipsis">{u.name}</span>
            <span className="small muted nowrap hide-sm">{L.dname(u.districtId)} · {ROLE_LABEL[u.role].split(' ')[0]}</span>
          </label>
        ))}
        {!list.length && <div className="small muted" style={{ padding: 8 }}>Никого не нашли — проверьте написание имени.</div>}
      </div>
    </div>
  );
}

/* ───────── Вложения ───────── */
const MAX_FILE = 1.5 * 1024 * 1024;
async function compressImage(file: File, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', 0.72);
}
/** Фото профиля — маленькое, хранится прямо в профиле */
export const fileToAvatar = (file: File) => compressImage(file, 256);

export async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (BACKEND) {
    try {
      const isPhoto = file.type.startsWith('image/');
      const blob = isPhoto ? await (await fetch(await compressImage(file))).blob() : file;
      const url = await uploadFile(getState().session.userId, blob, isPhoto ? file.name.replace(/\.\w+$/, '') + '.jpg' : file.name);
      return { id: uid('a'), name: file.name, kind: isPhoto ? 'photo' : 'file', url, size: blob.size };
    } catch (e) {
      toast((e as Error).message, 'error');
      return null;
    }
  }
  if (file.type.startsWith('image/')) {
    const url = await compressImage(file);
    return { id: uid('a'), name: file.name, kind: 'photo', url, size: Math.round(url.length * 0.75) };
  }
  if (file.size > MAX_FILE) {
    toast(`Файл «${file.name}» больше 1,5 МБ. В демо-режиме загрузите его в облако и прикрепите ссылку.`, 'error');
    return null;
  }
  const url = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.readAsDataURL(file); });
  return { id: uid('a'), name: file.name, kind: 'file', url, size: file.size };
}

export function AttachmentView({ a, onRemove }: { a: Attachment; onRemove?: () => void }) {
  // Файлы из хранилища открываются по временной подписанной ссылке
  const stored = a.url.startsWith(STORAGE_PREFIX);
  const [href, setHref] = useState(stored ? '' : a.url);
  useEffect(() => { if (stored) signedUrl(a.url).then(setHref); }, [a.url, stored]);
  return (
    <span className="attach">
      {a.kind === 'photo' ? (href ? <img src={href} alt={a.name} /> : <ImageIcon size={16} className="muted" />) : a.kind === 'link' ? <Link2 size={16} className="muted" /> : <Paperclip size={16} className="muted" />}
      <a href={href || undefined} target="_blank" rel="noreferrer" download={a.kind === 'file' && !stored ? a.name : undefined} className="ellipsis" style={{ maxWidth: 240 }}>{a.name}</a>
      {a.kind === 'link' && <ExternalLink size={13} className="muted" />}
      {onRemove && <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Удалить ${a.name}`} onClick={onRemove}><Trash2 size={14} /></button>}
    </span>
  );
}

export function AttachmentInput({ value, onChange }: { value: Attachment[]; onChange: (v: Attachment[]) => void }) {
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const addLink = () => {
    const v = link.trim();
    if (!v) return;
    if (!/^https?:\/\/\S+\.\S+/.test(v)) { setErr('Ссылка должна начинаться с http:// или https://'); return; }
    onChange([...value, { id: uid('a'), name: v.replace(/^https?:\/\//, '').slice(0, 60), kind: 'link', url: v }]);
    setLink(''); setErr('');
  };
  return (
    <div className="col">
      <div className="row wrap">
        <input className={`input ${err ? 'invalid' : ''}`} style={{ flex: '1 1 220px' }} placeholder="https://disk.yandex.ru/…" value={link} onChange={(e) => { setLink(e.target.value); setErr(''); }} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLink())} aria-label="Ссылка" />
        <Button icon={Link2} onClick={addLink}>Добавить ссылку</Button>
        <Button icon={Upload} onClick={() => fileRef.current?.click()}>Фото или файл</Button>
        <input ref={fileRef} type="file" multiple hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          const out: Attachment[] = [];
          for (const f of files) { const a = await fileToAttachment(f); if (a) out.push(a); }
          onChange([...value, ...out]);
          e.target.value = '';
        }} />
      </div>
      {err && <span className="err small" style={{ color: 'var(--c-danger)' }}>{err}</span>}
      {value.length > 0 && <div className="row wrap">{value.map((a) => <AttachmentView key={a.id} a={a} onRemove={() => onChange(value.filter((x) => x.id !== a.id))} />)}</div>}
      {value.length === 0 && <span className="small muted"><ImageIcon size={13} style={{ verticalAlign: -2 }} /> Фото сжимаются автоматически. Файлы — до {BACKEND ? '10' : '1,5'} МБ, крупнее — ссылкой на облако.</span>}
    </div>
  );
}

export { PriorityTag };
