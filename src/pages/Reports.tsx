import { ArrowLeft, Check, Download, FileSpreadsheet, FileText, Printer, RotateCcw, Save, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { num, pct, reportData } from '../data/calc';
import * as P from '../data/perm';
import { reviewReport, saveReport, sendReport, useAppState } from '../data/store';
import type { Report, ReportStatus, State } from '../data/types';
import { EVENT_TYPE_LABEL, REPORT_STATUS_LABEL, STATUS_LABEL } from '../data/types';
import { fmtDate, fmtDayMonth, fmtRange, fmtStamp, fmtTime, plural } from '../lib/date';
import { go, type Route } from '../lib/router';
import { openEvent, openRecords, openTask } from '../ui/global';
import { useLookup, useMe } from '../ui/hooks';
import { Avatar, Button, Empty, Field, Modal, ReportBadge, run, Textarea, toast } from '../ui/kit';

export default function ReportsPage({ route }: { route: Route }) {
  if (route.parts[1]) return <ReportView id={route.parts[1]} />;
  return <ReportList />;
}

function ReportList() {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const [district, setDistrict] = useState('');
  const [status, setStatus] = useState('');
  const list = useMemo(() => s.reports.filter((r) => P.canSeeReport(me, r) && (!district || r.districtId === district) && (!status || r.status === status)).sort((a, b) => b.weekStart.localeCompare(a.weekStart) || L.dname(a.districtId).localeCompare(L.dname(b.districtId))), [s.reports, me, district, status, L]);
  const toReview = s.reports.filter((r) => P.canReviewReport(me, r)).length;
  return (
    <>
      <div className="page-head">
        <div className="grow"><h1>Отчёты</h1><div className="sub">Недельный отчёт округа собирается автоматически из подтверждённых задач и мероприятий</div></div>
        <Button icon={FileSpreadsheet} onClick={() => exportMany(s, list)} disabled={!list.length}>Сводка в Excel</Button>
      </div>
      {toReview > 0 && <div className="callout warn" style={{ marginBottom: 14 }}><Send size={16} />Ждут вашей проверки: <b>{toReview}</b> <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setStatus('sent')}>Показать</button></div>}
      <div className="toolbar">
        {P.isManager(me) && <select className="select select-sm" style={{ width: 160 }} value={district} onChange={(e) => setDistrict(e.target.value)} aria-label="Округ"><option value="">Все округа</option>{s.districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
        <select className="select select-sm" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус"><option value="">Все статусы</option>{(Object.keys(REPORT_STATUS_LABEL) as ReportStatus[]).map((k) => <option key={k} value={k}>{REPORT_STATUS_LABEL[k]}</option>)}</select>
        {(district || status) && <Button size="sm" variant="ghost" onClick={() => { setDistrict(''); setStatus(''); }}>Сбросить</Button>}
      </div>
      {list.length === 0 ? <div className="card"><Empty icon={FileText} title="Отчётов нет" text={me.role === 'member' ? 'Здесь появятся принятые отчёты вашего округа.' : 'Измените фильтры.'} /></div> : (
        <div className="card table-wrap">
          <table className="tbl tbl-cards">
            <thead><tr><th>Округ</th><th>Неделя</th><th className="right">Подтверждено задач</th><th className="right">Мероприятий</th><th>Статус</th><th className="hide-card">Обновлён</th></tr></thead>
            <tbody>
              {list.map((r) => {
                const d = reportData(s, r.districtId, r.weekStart);
                return (
                  <tr key={r.id} className="clickable" tabIndex={0} onClick={() => go(`/reports/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && go(`/reports/${r.id}`)}>
                    <td className="t-title">{L.dname(r.districtId)}</td>
                    <td className="nowrap">{fmtRange(d.from, d.to)}</td>
                    <td className="right">{d.tasks.length}</td>
                    <td className="right">{d.events.length}</td>
                    <td><ReportBadge status={r.status} /></td>
                    <td className="hide-card small muted nowrap">{fmtStamp(r.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ReportView({ id }: { id: string }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const r = s.reports.find((x) => x.id === id);
  const [form, setForm] = useState({ conclusions: '', problems: '', plan: '' });
  const [returnOpen, setReturnOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (r) setForm({ conclusions: r.conclusions, problems: r.problems, plan: r.plan }); }, [r?.id, r?.status]); // eslint-disable-line
  if (!r || !P.canSeeReport(me, r)) return <Empty icon={FileText} title="Отчёт недоступен" text="Отчёт не найден или не входит в доступные вашей роли." action={<Button onClick={() => go('/reports')}>К отчётам</Button>} />;
  const d = reportData(s, r.districtId, r.weekStart);
  const editable = P.canEditReport(me, r);
  const dirty = form.conclusions !== r.conclusions || form.problems !== r.problems || form.plan !== r.plan;
  const save = () => run(() => saveReport(r.id, form), 'Отчёт сохранён');
  return (
    <>
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => go('/reports')} style={{ marginBottom: 10 }} className="no-print">Все отчёты</Button>
      <div className="page-head">
        <div className="grow">
          <div className="row"><ReportBadge status={r.status} /><span className="small muted">обновлён {fmtStamp(r.updatedAt)}</span></div>
          <h1 style={{ marginTop: 8 }}>Отчёт округа {L.dname(r.districtId)}</h1>
          <div className="sub">Неделя {fmtRange(d.from, d.to)} · координатор {L.user(L.districts.get(r.districtId)?.coordinatorId)?.name}</div>
        </div>
        <div className="row wrap no-print">
          <Button icon={FileSpreadsheet} onClick={() => exportOne(s, r)}>Excel</Button>
          <Button icon={Download} onClick={() => exportCsv(s, r)}>CSV</Button>
          <Button icon={Printer} onClick={() => window.print()}>PDF / печать</Button>
        </div>
      </div>
      {r.status === 'returned' && r.returnComment && <div className="callout danger" style={{ marginBottom: 14 }}><RotateCcw size={16} style={{ flex: 'none', marginTop: 2 }} /><span><b>Отчёт возвращён:</b> {r.returnComment}</span></div>}
      {P.canReviewReport(me, r) && (
        <div className="callout warn no-print" style={{ marginBottom: 14, alignItems: 'center' }}>
          <Send size={16} /><span className="grow">Отчёт отправлен координатором и ждёт вашей проверки.</span>
          <Button variant="success" icon={Check} size="sm" onClick={() => run(() => reviewReport(r.id, true), 'Отчёт принят')}>Принять</Button>
          <Button variant="danger" icon={RotateCcw} size="sm" onClick={() => setReturnOpen(true)}>Вернуть</Button>
        </div>
      )}

      <div className="grid g-main">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><h2 className="grow">Показатели недели</h2><span className="small muted">рассчитано из подтверждённых задач</span></div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Показатель</th><th className="right">План</th><th className="right">Факт</th><th className="right">%</th><th className="right">Источник</th></tr></thead>
                <tbody>
                  {d.facts.map((f) => (
                    <tr key={f.metric.id} className="clickable" onClick={() => openRecords({ title: `${f.metric.name}: исходные задачи`, rule: 'Сумма фактических значений из задач, подтверждённых на этой неделе.', tasks: f.records, cellValue: (t) => String(t.result?.value ?? 0) })}>
                      <td>{f.metric.name} <span className="muted small">{f.metric.unit}</span></td>
                      <td className="right">{f.plan}</td><td className="right num">{num(f.fact)}</td><td className="right">{pct(f.pct)}</td>
                      <td className="right"><span className="small" style={{ color: 'var(--brand-600)' }}>{f.records.length} {plural(f.records.length, ['задача', 'задачи', 'задач'])} →</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Подтверждённые задачи · {d.tasks.length}</h2></div>
            <div className="card-body" style={{ padding: '8px 0' }}>
              {d.tasks.length === 0 ? <Empty icon={FileText} title="За неделю нет подтверждённых задач" text="Как только координатор подтвердит выполнение, задача появится здесь автоматически." /> : d.tasks.map((t) => (
                <button key={t.id} className="list-item" onClick={() => openTask(t.id)}>
                  <Avatar user={L.user(t.assigneeId)} size={28} />
                  <div className="grow"><div className="title ellipsis">{t.title}</div><div className="small muted ellipsis">{L.user(t.assigneeId)?.name} · подтверждено {fmtDate(t.confirmedAt)}{t.result?.text ? ` · ${t.result.text}` : ''}</div></div>
                  {t.metricId && t.result?.value !== undefined && <span className="badge badge-brand">+{t.result.value}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Мероприятия недели · {d.events.length}</h2></div>
            <div className="card-body" style={{ padding: '8px 0' }}>
              {d.events.length === 0 ? <Empty icon={FileText} title="Мероприятий не было" /> : d.events.map((e) => (
                <button key={e.id} className="list-item" onClick={() => openEvent(e.id)}><span className="grow"><b>{e.title}</b><div className="small muted">{fmtDayMonth(e.start)}, {fmtTime(e.start)} · {EVENT_TYPE_LABEL[e.type]} · {e.participantIds.length} участников</div></span></button>
              ))}
            </div>
          </div>
        </div>
        <div className="col" style={{ gap: 16 }}>
          <div className="card card-pad col" style={{ gap: 14 }}>
            <h2>Комментарий координатора</h2>
            {editable ? (
              <>
                <Field label="Выводы" required hint="Главное за неделю в 2–3 предложениях"><Textarea rows={4} value={form.conclusions} onChange={(e) => setForm({ ...form, conclusions: e.target.value })} /></Field>
                <Field label="Проблемы"><Textarea rows={3} value={form.problems} onChange={(e) => setForm({ ...form, problems: e.target.value })} /></Field>
                <Field label="План на следующую неделю"><Textarea rows={3} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} /></Field>
                <div className="row wrap no-print">
                  <Button icon={Save} disabled={!dirty} onClick={save}>Сохранить черновик</Button>
                  <Button variant="primary" icon={Send} onClick={() => { if (dirty) saveReport(r.id, form); run(() => sendReport(r.id), 'Отчёт отправлен руководителю'); }}>Отправить</Button>
                </div>
              </>
            ) : (
              <>
                {(['conclusions', 'problems', 'plan'] as const).map((k) => (
                  <div key={k}><div className="label">{k === 'conclusions' ? 'Выводы' : k === 'problems' ? 'Проблемы' : 'План на следующую неделю'}</div><p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{r[k] || <span className="muted">—</span>}</p></div>
                ))}
                {r.status === 'sent' && <div className="small muted">Отчёт отправлен — редактирование закрыто до проверки.</div>}
              </>
            )}
          </div>
          {d.overdue.length > 0 && <button className="kpi" onClick={() => openRecords({ title: 'Просроченные задачи округа', tasks: d.overdue })}><span className="kpi-label">Просрочено в округе сейчас</span><span className="kpi-value" style={{ color: 'var(--c-danger)' }}>{d.overdue.length}</span><span className="kpi-foot">Открыть список</span></button>}
          {r.history.length > 0 && <div className="card card-pad"><h3 style={{ marginBottom: 10 }}>История</h3><div className="timeline">{[...r.history].reverse().map((h, i) => <div key={i}><b>{L.user(h.userId)?.name}</b> — {h.text}<div className="small muted">{fmtStamp(h.at)}</div></div>)}</div></div>}
        </div>
      </div>

      <Modal open={returnOpen} onClose={() => setReturnOpen(false)} title="Вернуть отчёт" footer={<><Button variant="ghost" onClick={() => setReturnOpen(false)}>Отмена</Button><Button variant="danger" onClick={() => { if (comment.trim().length < 5) { setErr('Напишите, что нужно исправить.'); return; } if (run(() => reviewReport(r.id, false, comment), 'Отчёт возвращён координатору')) setReturnOpen(false); }}>Вернуть</Button></>}>
        <Field label="Что исправить" required error={err}><Textarea autoFocus rows={4} value={comment} invalid={!!err} onChange={(e) => { setComment(e.target.value); setErr(''); }} /></Field>
      </Modal>
    </>
  );
}

/* ───────── Экспорт ───────── */
function rowsFor(s: State, r: Report) {
  const d = reportData(s, r.districtId, r.weekStart);
  const dn = s.districts.find((x) => x.id === r.districtId)?.name ?? '';
  const uname = (id?: string | null) => s.users.find((u) => u.id === id)?.name ?? '';
  return {
    d, dn,
    summary: [
      ['Округ', dn], ['Неделя', `${fmtDate(d.from)} — ${fmtDate(d.to)}`], ['Статус', REPORT_STATUS_LABEL[r.status]],
      ['Выводы', r.conclusions], ['Проблемы', r.problems], ['План', r.plan], [],
      ['Показатель', 'Единица', 'План', 'Факт', '%', 'ID задач-источников'],
      ...d.facts.map((f) => [f.metric.name, f.metric.unit, f.plan, f.fact, Math.round(f.pct * 100), f.records.map((t) => t.id).join(', ')]),
    ],
    tasks: [['ID', 'Задача', 'Ответственный', 'Срок', 'Сдано', 'Подтверждено', 'Статус', 'Показатель', 'Значение', 'Результат', 'Ссылка'],
      ...d.tasks.map((t) => [t.id, t.title, uname(t.assigneeId), fmtDate(t.due), fmtDate(t.result?.submittedDate), fmtDate(t.confirmedAt), STATUS_LABEL[t.status], s.metrics.find((m) => m.id === t.metricId)?.name ?? '', t.result?.value ?? '', t.result?.text ?? '', `${location.origin}${location.pathname}#/tasks/${t.id}`])],
    events: [['Мероприятие', 'Дата', 'Время', 'Место', 'Участников'], ...d.events.map((e) => [e.title, fmtDate(e.start.slice(0, 10)), fmtTime(e.start), e.place, e.participantIds.length])],
  };
}
async function exportOne(s: State, r: Report) {
  const XLSX = await import('xlsx');
  const x = rowsFor(s, r);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(x.summary), 'Сводка');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(x.tasks), 'Задачи');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(x.events), 'Мероприятия');
  XLSX.writeFile(wb, `Отчёт_${x.dn}_${r.weekStart}.xlsx`);
  toast('Файл Excel сохранён');
}
async function exportMany(s: State, list: Report[]) {
  const XLSX = await import('xlsx');
  const rows = [['Округ', 'Неделя с', 'Статус', 'Подтверждено задач', 'Мероприятий', ...s.metrics.map((m) => `${m.name}, факт`), 'Выводы', 'Проблемы', 'План']];
  for (const r of list) {
    const d = reportData(s, r.districtId, r.weekStart);
    rows.push([s.districts.find((x) => x.id === r.districtId)?.name ?? '', fmtDate(r.weekStart), REPORT_STATUS_LABEL[r.status], String(d.tasks.length), String(d.events.length), ...d.facts.map((f) => String(f.fact)), r.conclusions, r.problems, r.plan]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Отчёты');
  XLSX.writeFile(wb, `Отчёты_округов.xlsx`);
  toast(`Выгружено отчётов: ${list.length}`);
}
function exportCsv(s: State, r: Report) {
  const x = rowsFor(s, r);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [...x.summary, [], ...x.tasks, [], ...x.events].map((row) => row.map(esc).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `Отчёт_${x.dn}_${r.weekStart}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Файл CSV сохранён');
}
