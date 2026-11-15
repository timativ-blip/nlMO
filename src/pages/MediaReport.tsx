import { Copy, Download, ImageDown, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PdData } from '../data/media-types';
import { buildMediaReport, mediaReportCsv, mediaReportSvg, mediaReportText, reportDate, reportDelta, reportWeekBefore, postCount, authorCount } from '../data/media-report';
import { SEASON_11 } from '../data/media-season';
import { fmtDate, fmtStamp, todayISO } from '../lib/date';
import { go } from '../lib/router';
import { Button, Empty, toast } from '../ui/kit';
import { MediaAuthorForm } from './MediaAuthorForm';

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function savePng(svg: string, name: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Не удалось подготовить изображение.')); img.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Не удалось подготовить изображение.');
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Не удалось сохранить изображение.')), 'image/png'));
    saveBlob(blob, name);
  } finally { URL.revokeObjectURL(url); }
}
export default function MediaReport({ data, stale }: { data: PdData; stale: boolean }) {
  const [to, setTo] = useState(() => reportDate(todayISO())), [comparison, setComparison] = useState('');
  const [q, setQ] = useState(''), [group, setGroup] = useState(''), [pngBusy, setPngBusy] = useState(false), [showText, setShowText] = useState(false);
  const compareTo = comparison || reportWeekBefore(to), valid = compareTo < to;
  const report = useMemo(() => buildMediaReport({ ...data, sourceStatus: stale ? 'stale' : data.sourceStatus }, to, valid ? compareTo : reportWeekBefore(to)), [data, to, compareTo, stale, valid]);
  const text = useMemo(() => mediaReportText(report), [report]);
  const query = q.toLowerCase().replace(/ё/g, 'е').trim();
  const blocks = [...report.rows, report.outside].filter(g => !group || group === g.id).map(g => ({ ...g, shown: g.authors.filter(a => !query || `${g.label} ${g.contact} ${a.name}`.toLowerCase().replace(/ё/g, 'е').includes(query)) })).filter(g => g.shown.length);
  const updateTo = (date: string) => { if (/^\d{4}-\d{2}-\d{2}$/.test(date)) setTo(reportDate(date)); };
  const download = async () => { setPngBusy(true); try { await savePng(mediaReportSvg(report), `Пиши-Делись_11_сезон_${to}.png`); } catch (e) { toast((e as Error).message, 'error'); } finally { setPngBusy(false); } };
  return <div className="media-season-report">
    <div className="card media-report-controls">
      <div><span className="eyebrow">11 сезон · 1 октября — 20 декабря 2026</span><h2>Отчёт по округам</h2><p className="muted small">Накопительно с начала сезона. Состав — из вкладки «Авторы».</p></div>
      <div className="media-report-dates">
        <label>Отчёт на дату<input className="input" type="date" min={SEASON_11.from} max={todayISO() < SEASON_11.to ? todayISO() : SEASON_11.to} value={to} onInput={e => updateTo(e.currentTarget.value)} onChange={e => updateTo(e.target.value)} /></label>
        <label>Сравнить с<input className="input" type="date" max={to} value={compareTo} onInput={e => setComparison(e.currentTarget.value)} onChange={e => setComparison(e.target.value)} /></label>
        <Button size="sm" onClick={() => setComparison('')}>Неделю назад</Button>
      </div>
      {!valid && <p className="danger-text" role="alert">Дата сравнения должна быть раньше даты отчёта.</p>}
    </div>
    <div className="media-report-overview" aria-label="Итоги сезона">
      {[['Зарегистрировано', report.all.registered, 'по именному списку'], ['В рейтинге', report.all.ranked, 'есть зачтённые посты'], ['Пишет', report.all.writing, `к дате сравнения +${report.all.writingDelta}`], ['Постов всего', report.all.posts, `${report.all.counted} зачтено · +${report.all.postsDelta} к сравнению`]].map(([label, value, sub]) => <div className="card" key={label}><span className="muted small">{label}</span><strong className="num">{value}</strong><span className="small muted">{sub}</span></div>)}
    </div>
    <div className="card media-report-sheet">
      <div className="media-report-sheet-head"><div><span className="eyebrow">Пиши-Делись · 11 сезон</span><h2>{fmtDate(report.from)} — {fmtDate(to)}</h2><p className="muted small">В скобках — изменение к {fmtDate(compareTo)}.</p></div><div className="row wrap"><Button size="sm" icon={Copy} disabled={!valid} onClick={async () => { try { await navigator.clipboard.writeText(text); toast('Отчёт и именной список скопированы'); } catch { setShowText(true); } }}>Скопировать отчёт</Button><Button size="sm" icon={ImageDown} disabled={pngBusy || !valid} onClick={download}>{pngBusy ? 'Готовим…' : 'Картинка PNG'}</Button><Button size="sm" icon={Download} disabled={!valid} onClick={() => saveBlob(new Blob([mediaReportCsv(report)], { type: 'text/csv;charset=utf-8' }), `Пиши-Делись_11_сезон_${to}.csv`)}>Таблица</Button></div></div>
      <div className="table-wrap"><table className="tbl media-report-table"><thead><tr><th scope="col">Округ</th><th scope="col">Зарегистрировано авторов</th><th scope="col">В рейтинге</th><th scope="col" className="media-report-writing">Сколько пишет</th><th scope="col">Количество постов</th></tr></thead><tbody>
        {[...report.rows.filter(g => g.id !== 'hq'), report.districts, ...report.rows.filter(g => g.id === 'hq'), report.total].map(g => <tr key={g.id} className={['districts', 'total'].includes(g.id) ? 'media-report-total' : ''}><th scope="row">{['districts', 'total'].includes(g.id) ? g.label : <button className="media-report-district" onClick={() => setGroup(g.id)}>{g.label}</button>}</th><td>{g.registered}</td><td>{g.ranked}</td><td className="media-report-writing"><b>{g.writing}</b><span className="media-report-delta">{reportDelta(g.writingDelta)}</span></td><td><b>{g.posts}</b><span className="media-report-delta">{reportDelta(g.postsDelta)}</span><small>{g.counted} зачтено</small></td></tr>)}
      </tbody></table></div>
      <div className="media-report-footnote"><p><b>В рейтинге</b> — есть хотя бы один пост со статусом «Выполнены». <b>Пишет</b> — есть хотя бы один пост любого статуса.</p><p>Сравнение пересчитывается по датам публикаций из текущей выгрузки. Изменения состава и статусов задним числом в него не входят.</p>{report.rows.filter(g => g.declared !== undefined && g.declared !== g.registered).map(g => <p key={g.id}>{g.label}: в заголовке таблицы указано {g.declared}, поимённо перечислено {g.registered}. В отчёт взят именной список.</p>)}<p className="small muted">Источник получен: {fmtStamp(report.updated)}.{data.workbookUrl && <> <a href={data.workbookUrl} target="_blank" rel="noreferrer">Открыть рабочую таблицу ↗</a></>}</p></div>
    </div>
    {report.outside.posts > 0 && <div className="callout"><Users size={20} /><span><b>Без подтверждённого округа: {authorCount(report.outside.writing)}, {postCount(report.outside.posts)}.</b><br />Они входят в общий итог выгрузки и показаны отдельно от округов. <button className="media-report-district" onClick={() => go('/media/loose')}>Проверить сопоставления →</button></span></div>}
    <div className="media-report-list-head"><div><h2>Именные списки</h2><p className="muted small">🟢 Есть посты · 🔴 Пока нет постов за выбранную часть сезона.</p></div><div className="row wrap"><MediaAuthorForm data={data} /><select className="select" aria-label="Округ в именном списке" value={group} onChange={e => setGroup(e.target.value)}><option value="">Все округа и штаб</option>{[...report.rows, report.outside].map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select><div className="search-input"><Search size={16} /><input className="input" aria-label="Найти автора в отчёте" placeholder="Имя, округ или контакт" value={q} onChange={e => setQ(e.target.value)} /></div></div></div>
    {blocks.length ? blocks.map(g => <details key={g.id} className="card media-report-roster" open={query || group ? true : undefined}><summary><span><b>{g.label}</b>{g.contact && <span className="muted small">{g.contact}</span>}</span><span className="small muted">{g.id === 'none' ? `Пишет ${g.writing}` : `Пишет ${g.writing} из ${g.registered}`} · {postCount(g.posts)}</span></summary><ul>{g.shown.map(a => <li key={a.index}><span role="img" aria-label={a.posts ? 'Есть посты' : 'Нет постов'}>{a.posts ? '🟢' : '🔴'}</span><span className="grow">{a.name}{!a.registered && <small className="muted">Вне списка «Авторы»</small>}</span><span className="num">{a.posts}<small className="muted">{a.counted} зачтено</small></span></li>)}</ul></details>) : <div className="card"><Empty icon={Search} title="Авторов не нашли" text="Попробуйте другое имя или сбросьте фильтр округа." /></div>}
    {showText && <div className="card"><label>Скопируйте отчёт вручную<textarea className="input" rows={12} readOnly value={text} onFocus={e => e.target.select()} /></label></div>}
  </div>;
}
