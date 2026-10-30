import { ArrowUpRight } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { fmtDayMonth, fmtRange } from '../lib/date';

export function AnimatedNumber({ value, precision = 0, suffix = '' }: { value: number; precision?: number; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDisplay(value); previous.current = value; return; }
    const start = performance.now(), from = previous.current;
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 550);
      setDisplay(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    previous.current = value;
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const format = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: precision, minimumFractionDigits: precision }).format(n) + suffix;
  return <span aria-label={format(value)}><span aria-hidden>{format(display)}</span></span>;
}

export function ProgressRing({ value, label = 'плана' }: { value: number; label?: string }) {
  const length = 2 * Math.PI * 46;
  return <div className="progress-ring" role="img" aria-label={`${Math.round(value * 100)}% ${label}`}>
    <svg viewBox="0 0 112 112" aria-hidden><circle className="ring-track" cx="56" cy="56" r="46" /><circle className="ring-value" cx="56" cy="56" r="46" strokeDasharray={length} strokeDashoffset={length * (1 - Math.min(1, Math.max(0, value)))} /></svg>
    <span><b><AnimatedNumber value={value * 100} suffix="%" /></b><small>{label}</small></span>
  </div>;
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const low = Math.min(...values), range = Math.max(1, Math.max(...values) - low);
  const points = values.map((value, i) => `${i * 100 / (values.length - 1)},${30 - (value - low) / range * 24}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 100 36" aria-hidden><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
}

export interface TimelinePoint { from: string; to: string; assigned: number; confirmed: number }
export function TimelineChart<T extends TimelinePoint>({ data, onPick }: { data: T[]; onPick?: (point: T) => void }) {
  const uid = useId().replace(/:/g, '');
  const hits = useRef<(SVGRectElement | null)[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const index = selected !== null && selected < data.length ? selected : Math.max(0, data.length - 1);
  const current = data[index];
  const W = 700, H = 238, left = 35, right = 18, top = 22, bottom = 35;
  const width = W - left - right, height = H - top - bottom;
  const max = Math.max(4, ...data.flatMap((d) => [d.assigned, d.confirmed]));
  const maxV = Math.ceil(max / 4) * 4;
  const step = width / Math.max(1, data.length);
  const x = (i: number) => left + (i + 0.5) * step;
  const y = (n: number) => top + height - n / maxV * height;
  const line = data.map((d, i) => i === 0 ? `M${x(i)},${y(d.confirmed)}` : `C${(x(i-1)+x(i))/2},${y(data[i-1].confirmed)} ${(x(i-1)+x(i))/2},${y(d.confirmed)} ${x(i)},${y(d.confirmed)}`).join(' ');
  if (!current) return <div className="chart-empty">За этот период данных пока нет.</div>;
  return <div className="timeline-chart">
    <div className="chart-readout" aria-live="off">
      <span className="small muted">{fmtRange(current.from, current.to)}</span>
      <span><i className="chart-dot" /><b>{current.confirmed}</b> подтверждено <span className="muted">· {current.assigned} по сроку</span></span>
      {onPick && <button type="button" className="chart-open" onClick={() => onPick(current)} aria-label={`Открыть подтверждённые задачи: ${fmtRange(current.from, current.to)}`}><ArrowUpRight size={16} /></button>}
    </div>
    <svg className="chart timeline-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label="Динамика задач. Столбцы — задачи по сроку, линия — подтверждённые результаты.">
      <defs><linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--teal)" stopOpacity=".2" /><stop offset="100%" stopColor="var(--teal)" stopOpacity="0" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map((n) => <g key={n} aria-hidden><line className="chart-grid" x1={left} x2={W-right} y1={y(maxV*n/4)} y2={y(maxV*n/4)} /><text x={left-10} y={y(maxV*n/4)+4} textAnchor="end">{maxV*n/4}</text></g>)}
      <path d={`${line} L${x(data.length-1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#area-${uid})`} aria-hidden />
      {data.map((d, i) => <g key={d.from} className={`chart-column ${index === i ? 'selected' : ''}`}>
        <rect className="chart-bar" x={x(i)-Math.min(15,step*.22)} y={y(d.assigned)} width={Math.min(30,step*.44)} height={height * d.assigned/maxV} rx={Math.min(7,step*.1)} aria-hidden />
        {(data.length <= 12 || i % Math.ceil(data.length/8) === 0 || i === data.length-1) && <text x={x(i)} y={H-9} textAnchor="middle" aria-hidden>{fmtDayMonth(d.from)}</text>}
      </g>)}
      <path className="chart-line" d={line} fill="none" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" aria-hidden pathLength="1" />
      {data.map((d, i) => <g key={d.from}>
        {index === i && <line x1={x(i)} x2={x(i)} y1={top} y2={y(0)} className="chart-guide" aria-hidden />}
        <circle className="chart-point" cx={x(i)} cy={y(d.confirmed)} r={index === i ? 5 : 3} aria-hidden />
        <rect ref={(node) => { hits.current[i] = node; }} x={left+i*step} y={top-10} width={step} height={height+18} fill="transparent" className="chart-hit" tabIndex={0} role={onPick ? 'button' : 'group'}
          aria-label={`${fmtRange(d.from, d.to)}: по сроку ${d.assigned}, подтверждено ${d.confirmed}${onPick ? '. Открыть задачи' : ''}`}
          onMouseEnter={() => setSelected(i)} onFocus={() => setSelected(i)} onClick={() => onPick?.(d)}
          onKeyDown={(event) => { if (onPick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onPick(d); } if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const next = (i + (event.key === 'ArrowRight' ? 1 : data.length-1)) % data.length; setSelected(next); hits.current[next]?.focus(); } }} />
      </g>)}
    </svg>
    <div className="chart-legend"><span><i className="legend-bar" />Задачи по сроку</span><span><i className="legend-line" />Подтверждённые результаты</span><span className="muted">Нажмите на период для подробностей</span></div>
  </div>;
}

export interface DonutSegment { id: string; label: string; value: number; color: string; onClick?: () => void }
export function DonutChart({ segments, label = 'задач' }: { segments: DonutSegment[]; label?: string }) {
  const total = segments.reduce((n, s) => n+s.value, 0), length = 2*Math.PI*46;
  let offset = 0;
  return <div className="donut-layout">
    <div className="donut-visual" role="img" aria-label={`${total} ${label}. ${segments.map((s) => `${s.label}: ${s.value}`).join(', ')}`}>
      <svg viewBox="0 0 120 120" aria-hidden><circle className="donut-track" cx="60" cy="60" r="46" />{segments.map((s) => {
        const arc = total ? s.value/total*length : 0, before = offset; offset += arc;
        return s.value ? <circle key={s.id} className="donut-segment" cx="60" cy="60" r="46" fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${Math.max(0,arc-3)} ${length}`} strokeDashoffset={-before} transform="rotate(-90 60 60)" /> : null;
      })}</svg><span><b><AnimatedNumber value={total} /></b><small>{total ? label : 'нет данных'}</small></span>
    </div>
    <div className="donut-legend">{segments.map((s) => <button type="button" key={s.id} onClick={s.onClick} disabled={!s.onClick || !s.value} className="donut-key" aria-label={`${s.label}: ${s.value}${s.onClick && s.value ? '. Открыть задачи' : ''}`}>
      <i style={{ background: s.color }} /><span>{s.label}</span><b>{s.value}</b><small>{total ? Math.round(s.value/total*100) : 0}%</small>
    </button>)}</div>
  </div>;
}

export function DayColumns<T extends { day: string; count: number }>({ days, onPick }: { days: T[]; onPick: (day: T) => void }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return <div className="day-columns">{days.map((d, i) => <button className={`day-column ${i === 0 ? 'today' : ''}`} type="button" key={d.day} onClick={() => onPick(d)} aria-label={`${fmtDayMonth(d.day)}: ${d.count} задач`}>
    <b>{d.count}</b><span className="day-track"><i style={{ height: `${d.count/max*100}%` }} /></span><small>{i === 0 ? 'Сегодня' : fmtDayMonth(d.day)}</small>
  </button>)}</div>;
}

export function ActivityHeatmap<T extends { day: string; future: boolean; count: number }>({ days, onPick }: { days: T[]; onPick: (day: T) => void }) {
  const max = Math.max(1,...days.map((d) => d.count));
  return <div className="activity-heatmap">
    <div className="heat-months"><span>{fmtDayMonth(days[0].day)}</span><span>Последние 12 недель</span><span>{fmtDayMonth(days[days.length-1].day)}</span></div>
    <div className="heat-body"><div className="heat-days" aria-hidden>{['Пн','','Ср','','Пт','','Вс'].map((d,i) => <span key={i}>{d}</span>)}</div><div className="heat-cells">{days.map((d) => <button key={d.day} type="button" disabled={d.future || !d.count} onClick={() => onPick(d)} className={`heat-cell ${d.future ? 'future' : ''}`} style={{ '--heat': d.count/max } as CSSProperties}
      title={`${fmtDayMonth(d.day)}: ${d.count} подтверждённых результатов`} aria-label={`${fmtDayMonth(d.day)}: ${d.count} подтверждённых результатов`} />)}</div></div>
    <div className="heat-scale"><span>Меньше</span>{[0,.15,.45,.7,1].map((n) => <i key={n} style={{ '--heat': n } as CSSProperties} />)}<span>Больше</span></div>
  </div>;
}
