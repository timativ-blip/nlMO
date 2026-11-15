import { fmtDayMonth, fmtRange } from '../lib/date';
import { AnimatedNumber, type TimelinePoint } from './charts';

/** Two independent series share a scale; they are never stacked or added. */
export function ComparisonColumns<T extends TimelinePoint>({ data, onPick }: {
  data: T[]; onPick: (point: T, series: 'assigned' | 'confirmed') => void;
}) {
  const max = Math.ceil(Math.max(2, ...data.flatMap(p => [p.assigned, p.confirmed])) / 2) * 2;
  const empty = data.every(p => !p.assigned && !p.confirmed);
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  return <div className="comparison-chart" role="group" aria-label="Задачи по сроку и подтверждённые результаты">
    <div className="comparison-plot">
      <div className="comparison-axis" aria-hidden><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div>
      <div className="comparison-bars">
        {data.map((point, index) => <div className="comparison-column" key={point.from}>
          <div className="comparison-pair">
            {(['assigned', 'confirmed'] as const).map(series => <button key={series} type="button" className={`comparison-bar ${series}`} onClick={() => onPick(point, series)}
              aria-label={`${fmtRange(point.from, point.to)}: ${series === 'assigned' ? 'задач по сроку' : 'подтверждённых результатов'} ${point[series]}. Открыть задачи`}
              title={`${fmtRange(point.from, point.to)} · ${series === 'assigned' ? 'По сроку' : 'Подтверждено'}: ${point[series]}`}>
              <span style={{ height: `${point[series] / max * 100}%` }}/>
            </button>)}
          </div>
          <span className="comparison-date">{index % labelEvery === 0 || index === data.length - 1 ? fmtDayMonth(point.from) : ''}</span>
        </div>)}
      </div>
      {empty && <span className="comparison-empty">За период пока нет задач и результатов</span>}
    </div>
    <div className="comparison-legend"><span><i className="assigned"/>Задачи по сроку</span><span><i className="confirmed"/>Подтверждено</span></div>
  </div>;
}

/** A bounded share, with a distinct no-data state instead of a made-up zero. */
export function SegmentGauge({ value, label }: { value: number | null; label: string }) {
  const share = value === null || !Number.isFinite(value) ? null : Math.min(1, Math.max(0, value));
  const point = (angle: number, radius = 77) => [105 + Math.cos(angle) * radius, 92 + Math.sin(angle) * radius];
  const angle = Math.PI + (share ?? 0) * Math.PI;
  const needle = point(angle, 57);
  return <div className="segment-gauge" role="img" aria-label={share === null ? `${label}: нет данных` : `${label}: ${Math.round(share * 100)}%`}>
    <svg viewBox="0 0 210 115" aria-hidden>
      {Array.from({ length: 20 }, (_, i) => {
        const segment = Math.PI + (i + .5) * Math.PI / 20;
        const a = point(segment, 65), b = point(segment, 80);
        return <line key={i} className={share !== null && i < Math.round(share * 20) ? 'gauge-lit' : 'gauge-track'} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/>;
      })}
      {share !== null && <><line x1="105" y1="92" x2={needle[0]} y2={needle[1]} className="gauge-needle"/><circle cx="105" cy="92" r="5" className="gauge-pivot"/></>}
    </svg>
    <b>{share === null ? '—' : <AnimatedNumber value={share * 100} suffix="%"/>}</b>
    <small>{share === null ? 'Нет подтверждённых результатов' : label}</small>
  </div>;
}
