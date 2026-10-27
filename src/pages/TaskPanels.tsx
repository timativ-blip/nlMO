import { AlertTriangle, Ban, CalendarDays, Check, ChevronDown, ChevronUp, History, ListChecks, MessageSquare, Paperclip, Play, Plus, RotateCcw, Send, Target, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isOnTime, isOverdue, taskPoints } from '../data/calc';
import * as P from '../data/perm';
import { addAttachment, addCheck, addComment, confirmTask, createTask, returnTask, setTaskStatus, submitResult, toggleCheck, updateTask, useAppState, validateTask, type TaskInput } from '../data/store';
import type { Attachment, Priority, Task } from '../data/types';
import { PRIORITY_LABEL } from '../data/types';
import { addDays, fmtAgo, fmtDate, fmtDayMonth, fmtStamp, relDue, todayISO } from '../lib/date';
import { closeNewTask, openEvent, openTask, useGlobal } from '../ui/global';
import { useLookup, useMe } from '../ui/hooks';
import { Avatar, Button, Drawer, Field, Input, Modal, PriorityTag, run, Select, Textarea, TaskStatusBadges } from '../ui/kit';
import { AttachmentInput, AttachmentView, PeoplePicker } from '../ui/widgets';

const PRIORITIES = (Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));

/** Люди, которых пользователь может назначать в округе */
export function useAssignable(districtId?: string) {
  const s = useAppState();
  const me = useMe();
  return useMemo(() => s.users.filter((u) => u.active && (P.isManager(me) ? (!districtId || u.districtId === districtId || u.districtId === null) : u.districtId === me.districtId)), [s.users, me, districtId]);
}

/* ───────── Быстрое создание ───────── */
export function NewTaskModal() {
  const g = useGlobal();
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const open = !!g.newTask;
  const [v, setV] = useState<TaskInput>(() => blank());
  const [more, setMore] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [checklist, setChecklist] = useState('');
  const [links, setLinks] = useState('');
  function blank(): TaskInput {
    return { title: '', assigneeId: '', districtId: me.role === 'coordinator' ? me.districtId! : '', due: addDays(todayISO(), 3), priority: 'normal', coAssigneeIds: [], description: '', metricId: null, eventId: null };
  }
  useEffect(() => {
    if (open) { setV({ ...blank(), ...g.newTask }); setErrs({}); setMore(!!(g.newTask?.eventId || g.newTask?.metricId)); setChecklist(''); setLinks(''); }
  }, [open]); // eslint-disable-line
  const people = useAssignable(v.districtId || undefined);
  const districts = s.districts.filter((d) => P.canAssignIn(me, d.id));
  const set = (p: Partial<TaskInput>) => { setV((x) => ({ ...x, ...p })); setErrs((e) => { const n = { ...e }; Object.keys(p).forEach((k) => delete n[k]); return n; }); };
  const onAssignee = (id: string) => {
    const u = L.user(id);
    set({ assigneeId: id, ...(u?.districtId && !v.districtId ? { districtId: u.districtId } : {}) });
  };
  const submit = (another = false) => {
    const e = validateTask(v);
    if (Object.keys(e).length) { setErrs(e); return; }
    let id = '';
    const ok = run(() => { id = createTask({ ...v, checklist: checklist.split('\n'), links: links.split(/\s+/) }); }, `Задача создана и назначена: ${L.user(v.assigneeId)?.name}`);
    if (!ok) return;
    if (another) { setV({ ...blank(), districtId: v.districtId, assigneeId: v.assigneeId }); setChecklist(''); setLinks(''); }
    else { closeNewTask(); openTask(id); }
  };
  if (!P.canCreateTask(me)) return null;
  const events = s.events.filter((e) => !e.cancelled && e.start >= todayISO() && (!v.districtId || e.districtId === v.districtId || e.districtId === null)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 30);
  return (
    <Modal open={open} onClose={closeNewTask} title="Новая задача" width={620}
      footer={<>
        <span className="small muted hide-sm" style={{ marginRight: 'auto', alignSelf: 'center' }}>Ctrl + Enter — создать</span>
        <Button variant="ghost" onClick={closeNewTask}>Отмена</Button>
        <Button onClick={() => submit(true)} className="hide-sm">Создать и ещё одну</Button>
        <Button variant="primary" icon={Check} onClick={() => submit()}>Создать задачу</Button>
      </>}>
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); submit(); }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}>
        <Field label="Что нужно сделать" required error={errs.title}>
          <Input autoFocus placeholder="Например: Провести встречу с жителями ЖК «Солнечный»" value={v.title} invalid={!!errs.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
        </Field>
        <div className="grid g-2" style={{ gap: 12 }}>
          <Field label="Ответственный" required error={errs.assigneeId}>
            <Select invalid={!!errs.assigneeId} value={v.assigneeId} onChange={(e) => onAssignee(e.target.value)} options={[{ value: '', label: 'Выберите человека' }, ...people.map((u) => ({ value: u.id, label: `${u.name}${u.districtId ? ' · ' + L.dname(u.districtId) : ''}` }))]} />
          </Field>
          <Field label="Срок" required error={errs.due} hint={v.due ? relDue(v.due) : undefined}>
            <Input type="date" min={todayISO()} value={v.due} invalid={!!errs.due} onChange={(e) => set({ due: e.target.value })} />
          </Field>
          <Field label="Округ" required error={errs.districtId} hint={me.role === 'coordinator' ? 'Координатор ставит задачи в своём округе' : 'Подставляется по ответственному'}>
            <Select invalid={!!errs.districtId} disabled={me.role === 'coordinator'} value={v.districtId} onChange={(e) => set({ districtId: e.target.value, assigneeId: L.user(v.assigneeId)?.districtId === e.target.value || !L.user(v.assigneeId)?.districtId ? v.assigneeId : '' })} options={[{ value: '', label: 'Выберите округ' }, ...districts.map((d) => ({ value: d.id, label: d.name }))]} />
          </Field>
          <Field label="Приоритет">
            <Select value={v.priority} onChange={(e) => set({ priority: e.target.value as Priority })} options={PRIORITIES} />
          </Field>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? <ChevronUp size={15} /> : <ChevronDown size={15} />} {more ? 'Скрыть дополнительные поля' : 'Описание, соисполнители, показатель, чек-лист'}
        </button>
        {more && (
          <div className="col" style={{ gap: 14 }}>
            <Field label="Описание"><Textarea rows={3} placeholder="Детали, ожидаемый результат, контакты" value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <div className="grid g-2" style={{ gap: 12 }}>
              <Field label="Связанный показатель" hint="Результат задачи попадёт в факт этого показателя">
                <Select value={v.metricId ?? ''} onChange={(e) => set({ metricId: e.target.value || null })} options={[{ value: '', label: 'Без показателя' }, ...s.metrics.map((m) => ({ value: m.id, label: `${m.name} (${m.unit})` }))]} />
              </Field>
              <Field label="Связанное мероприятие">
                <Select value={v.eventId ?? ''} onChange={(e) => set({ eventId: e.target.value || null })} options={[{ value: '', label: 'Без мероприятия' }, ...events.map((e) => ({ value: e.id, label: `${fmtDayMonth(e.start)} · ${e.title}` }))]} />
              </Field>
            </div>
            <div className="field"><span className="label">Соисполнители</span><PeoplePicker value={v.coAssigneeIds ?? []} onChange={(x) => set({ coAssigneeIds: x })} users={people.filter((u) => u.id !== v.assigneeId)} label="Соисполнители" /></div>
            <Field label="Чек-лист" hint="Каждый пункт с новой строки"><Textarea rows={3} value={checklist} onChange={(e) => setChecklist(e.target.value)} placeholder={'Согласовать место\nПодготовить материалы'} /></Field>
            <Field label="Ссылки" hint="Через пробел или с новой строки"><Input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" /></Field>
          </div>
        )}
      </form>
    </Modal>
  );
}

/* ───────── Сдача результата ───────── */
export function SubmitModal({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const L = useLookup();
  const [text, setText] = useState('');
  const [value, setValue] = useState('');
  const [att, setAtt] = useState<Attachment[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (task) { setText(''); setValue(''); setAtt([]); setErrs({}); } }, [task?.id]);
  if (!task) return null;
  const m = task.metricId ? L.metrics.get(task.metricId) : null;
  const send = () => {
    const e: Record<string, string> = {};
    if (text.trim().length < 5) e.text = 'Опишите, что сделано — хотя бы одно предложение.';
    if (m && (value === '' || isNaN(+value) || +value < 0)) e.value = `Укажите число ${m.unit} — это попадёт в показатель «${m.name}».`;
    if (Object.keys(e).length) { setErrs(e); return; }
    if (run(() => submitResult(task.id, { text, value: m ? +value : undefined, attachments: att }), 'Результат отправлен на проверку координатору')) onClose();
  };
  return (
    <Modal open onClose={onClose} title="Сдать результат" width={600} footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary" icon={Send} onClick={send}>Отправить на проверку</Button></>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="callout info"><Target size={16} style={{ flex: 'none', marginTop: 2 }} /><span><b>{task.title}</b><br />Срок: {fmtDate(task.due)}{task.due < todayISO() ? ' — срок прошёл, результат будет учтён как сданный с опозданием' : ''}</span></div>
        <Field label="Что сделано" required error={errs.text}><Textarea autoFocus rows={4} invalid={!!errs.text} value={text} onChange={(e) => { setText(e.target.value); setErrs({ ...errs, text: '' }); }} placeholder="Коротко: что сделали, сколько людей участвовало, что важно знать" /></Field>
        {m && (
          <Field label={`Фактическое значение: ${m.name}`} required error={errs.value} hint={`Единица — ${m.unit}`}>
            <Input type="number" inputMode="numeric" min={0} invalid={!!errs.value} value={value} onChange={(e) => { setValue(e.target.value); setErrs({ ...errs, value: '' }); }} style={{ maxWidth: 200 }} />
          </Field>
        )}
        <div className="field"><span className="label">Фото, файлы или ссылки</span><AttachmentInput value={att} onChange={setAtt} /></div>
      </div>
    </Modal>
  );
}

/* ───────── Возврат на доработку ───────── */
export function ReturnModal({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const [c, setC] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setC(''); setErr(''); }, [task?.id]);
  if (!task) return null;
  const send = () => {
    if (c.trim().length < 5) { setErr('Комментарий обязателен: напишите, что именно нужно доработать.'); return; }
    if (run(() => returnTask(task.id, c), 'Задача возвращена на доработку, исполнитель получил уведомление')) onClose();
  };
  return (
    <Modal open onClose={onClose} title="Вернуть на доработку" footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="danger" icon={RotateCcw} onClick={send}>Вернуть</Button></>}>
      <Field label="Что нужно доработать" required error={err}><Textarea autoFocus rows={4} invalid={!!err} value={c} onChange={(e) => { setC(e.target.value); setErr(''); }} placeholder="Например: добавьте список вопросов жителей и число участников" /></Field>
    </Modal>
  );
}

function CancelModal({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const [c, setC] = useState('');
  const [err, setErr] = useState('');
  if (!task) return null;
  return (
    <Modal open onClose={onClose} title="Отменить задачу" footer={<><Button variant="ghost" onClick={onClose}>Не отменять</Button><Button variant="danger" icon={Ban} onClick={() => { if (c.trim().length < 3) { setErr('Укажите причину отмены.'); return; } if (run(() => setTaskStatus(task.id, 'cancelled', c), 'Задача отменена. Она не учитывается в показателях и рейтинге')) onClose(); }}>Отменить задачу</Button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Отменённые задачи учитываются отдельно и не влияют на выполнение плана и рейтинг.</p>
      <Field label="Причина" required error={err}><Textarea autoFocus rows={3} value={c} invalid={!!err} onChange={(e) => { setC(e.target.value); setErr(''); }} /></Field>
    </Modal>
  );
}

/* ───────── Карточка задачи ───────── */
export function TaskDrawer() {
  const g = useGlobal();
  const s = useAppState();
  const t = s.tasks.find((x) => x.id === g.taskId) ?? null;
  const me = useMe();
  const close = () => {
    openTask(null);
    if (location.hash.startsWith('#/tasks/')) location.replace('#/tasks');
  };
  if (!g.taskId) return null;
  if (!t || !P.canSeeTask(me, t))
    return <Drawer open onClose={close} head={<b>Задача недоступна</b>}><div className="callout warn"><AlertTriangle size={16} />Задача не найдена или у вашей роли нет к ней доступа. Задачи видны ответственному, соисполнителям, автору, координатору округа и штабу.</div></Drawer>;
  return <TaskDrawerInner t={t} onClose={close} />;
}

function TaskDrawerInner({ t, onClose }: { t: Task; onClose: () => void }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const [submitOpen, setSubmit] = useState(false);
  const [returnOpen, setReturn] = useState(false);
  const [cancelOpen, setCancel] = useState(false);
  const [comment, setComment] = useState('');
  const [check, setCheck] = useState('');
  const [editTitle, setEditTitle] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.description);
  const [newAtt, setNewAtt] = useState<Attachment[]>([]);
  useEffect(() => { setTitle(t.title); setDesc(t.description); }, [t.id, t.title, t.description]);
  const canEdit = P.canEditTask(me, t);
  const people = useAssignable(t.districtId);
  const metric = t.metricId ? L.metrics.get(t.metricId) : null;
  const ev = t.eventId ? L.events.get(t.eventId) : null;
  const doneCount = t.checklist.filter((c) => c.done).length;
  const involved = P.isInvolved(me, t) || canEdit;

  useEffect(() => {
    if (newAtt.length) { newAtt.forEach((a) => run(() => addAttachment(t.id, a))); setNewAtt([]); }
  }, [newAtt]); // eslint-disable-line

  return (
    <Drawer open onClose={onClose} head={<><TaskStatusBadges t={t} /><span className="small muted hide-sm">#{t.id.slice(-5)}</span></>}>
      {editTitle ? (
        <form onSubmit={(e) => { e.preventDefault(); if (run(() => updateTask(t.id, { title }), 'Название сохранено')) setEditTitle(false); }} className="row">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-label="Название задачи" />
          <Button variant="primary" type="submit">Сохранить</Button>
        </form>
      ) : (
        <h1 style={{ fontSize: 22, overflowWrap: 'anywhere', cursor: canEdit ? 'text' : undefined }} onClick={() => canEdit && setEditTitle(true)} title={canEdit ? 'Нажмите, чтобы изменить' : undefined}>{t.title}</h1>
      )}

      {/* Контекстные действия — только доступные роли */}
      <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
        {P.canStart(me, t) && <Button icon={Play} onClick={() => run(() => setTaskStatus(t.id, 'in_progress'), 'Задача в работе')}>Взять в работу</Button>}
        {P.canSubmit(me, t) && <Button variant="primary" icon={Send} onClick={() => setSubmit(true)}>Сдать результат</Button>}
        {P.canReview(me, t) && <Button variant="success" icon={Check} onClick={() => run(() => confirmTask(t.id), 'Выполнение подтверждено — отчёт, показатели и рейтинг обновлены')}>Принять результат</Button>}
        {P.canReview(me, t) && <Button variant="danger" icon={RotateCcw} onClick={() => setReturn(true)}>Вернуть на доработку</Button>}
        {canEdit && t.status !== 'cancelled' && t.status !== 'done' && t.status !== 'review' && <Button variant="ghost" icon={Ban} onClick={() => setCancel(true)}>Отменить</Button>}
      </div>
      {t.status === 'review' && !P.canReview(me, t) && <div className="callout warn" style={{ marginTop: 12 }}>Результат ожидает проверки координатора округа {L.dname(t.districtId)}.</div>}
      {t.status === 'in_progress' && t.returnedAt && (
        <div className="callout danger" style={{ marginTop: 12 }}><RotateCcw size={16} style={{ flex: 'none', marginTop: 2 }} /><span><b>Возвращено на доработку:</b> {[...t.comments].reverse().find((c) => c.kind === 'return')?.text}</span></div>
      )}
      {t.status === 'done' && (
        <div className="callout ok" style={{ marginTop: 12 }}><Trophy size={16} style={{ flex: 'none', marginTop: 2 }} /><span>Подтверждено {fmtDate(t.confirmedAt)} · {L.user(t.confirmedBy)?.name}. {isOnTime(t) ? 'Сдано вовремя' : 'Сдано с опозданием'}, вклад в рейтинг: <b>{taskPoints(s, t).toFixed(1)} балла</b>{metric && t.result?.value !== undefined ? `, в показатель «${metric.name}»: +${t.result.value}` : ''}.</span></div>
      )}

      <dl className="meta-grid section">
        <dt>Ответственный</dt>
        <dd>{canEdit ? (
          <select className="select select-sm inline-select" style={{ maxWidth: 300 }} value={t.assigneeId} onChange={(e) => run(() => updateTask(t.id, { assigneeId: e.target.value }), 'Ответственный изменён, уведомление отправлено')} aria-label="Ответственный">
            {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        ) : <span className="row"><Avatar user={L.user(t.assigneeId)} size={24} />{L.user(t.assigneeId)?.name}</span>}</dd>
        <dt>Соисполнители</dt>
        <dd>{t.coAssigneeIds.length ? <span className="row wrap">{t.coAssigneeIds.map((id) => <span key={id} className="row" style={{ gap: 5 }}><Avatar user={L.user(id)} size={22} />{L.user(id)?.name}</span>)}</span> : <span className="muted">—</span>}</dd>
        <dt>Срок</dt>
        <dd>{canEdit ? (
          <span className="row"><input type="date" className="input input-sm" style={{ width: 160 }} value={t.due} onChange={(e) => e.target.value && run(() => updateTask(t.id, { due: e.target.value }), 'Срок изменён')} aria-label="Срок" />
            <span className={`small ${isOverdue(t) ? 'overdue-text' : 'muted'}`}>{isOverdue(t) ? 'просрочена' : relDue(t.due)}</span></span>
        ) : <span className={isOverdue(t) ? 'overdue-text' : ''}>{fmtDate(t.due)} · {relDue(t.due)}</span>}</dd>
        <dt>Приоритет</dt>
        <dd>{canEdit ? <select className="select select-sm inline-select" style={{ width: 160 }} value={t.priority} onChange={(e) => run(() => updateTask(t.id, { priority: e.target.value as Priority }), 'Приоритет изменён')} aria-label="Приоритет">{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select> : <PriorityTag p={t.priority} />}</dd>
        <dt>Округ</dt><dd><a href={`#/team/districts/${t.districtId}`}>{L.dname(t.districtId)}</a></dd>
        <dt>Автор</dt><dd className="row"><Avatar user={L.user(t.authorId)} size={22} />{L.user(t.authorId)?.name} <span className="small muted">· {fmtStamp(t.createdAt)}</span></dd>
        <dt>Показатель</dt><dd>{metric ? <a href="#/analytics/metrics">{metric.name}</a> : <span className="muted">—</span>}</dd>
        <dt>Мероприятие</dt><dd>{ev ? <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => openEvent(ev.id)}><CalendarDays size={14} />{ev.title}, {fmtDayMonth(ev.start)}</button> : <span className="muted">—</span>}</dd>
      </dl>

      <div className="section">
        <h3>Описание</h3>
        {canEdit ? (
          <Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== t.description && run(() => updateTask(t.id, { description: desc }), 'Описание сохранено')} placeholder="Добавьте детали задачи" aria-label="Описание" />
        ) : <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{t.description || <span className="muted">Описание не добавлено</span>}</p>}
      </div>

      {t.result && (
        <div className="section">
          <h3><Target size={16} />Результат</h3>
          <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{t.result.text}</div>
            {metric && t.result.value !== undefined && <div style={{ marginTop: 8 }}><span className="badge badge-brand">{metric.name}: {t.result.value} {metric.unit}</span></div>}
            {t.result.attachments.length > 0 && <div className="row wrap" style={{ marginTop: 10 }}>{t.result.attachments.map((a) => <AttachmentView key={a.id} a={a} />)}</div>}
            <div className="small muted" style={{ marginTop: 8 }}>Сдано {fmtStamp(t.result.submittedAt)} · {isOnTime(t) ? 'в срок' : 'после срока'}</div>
          </div>
        </div>
      )}

      <div className="section">
        <h3><ListChecks size={16} />Чек-лист {t.checklist.length > 0 && <span className="small muted">{doneCount} из {t.checklist.length}</span>}</h3>
        {t.checklist.map((c) => (
          <label key={c.id} className={`checklist-item check ${c.done ? 'done' : ''}`}>
            <input type="checkbox" checked={c.done} disabled={!involved} onChange={() => run(() => toggleCheck(t.id, c.id))} /><span>{c.text}</span>
          </label>
        ))}
        {involved && (
          <form className="row" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); if (check.trim() && run(() => addCheck(t.id, check))) setCheck(''); }}>
            <input className="input input-sm" placeholder="Новый пункт" value={check} onChange={(e) => setCheck(e.target.value)} aria-label="Новый пункт чек-листа" />
            <Button size="sm" icon={Plus} type="submit">Добавить</Button>
          </form>
        )}
      </div>

      <div className="section">
        <h3><Paperclip size={16} />Вложения и ссылки</h3>
        {t.attachments.length > 0 && <div className="row wrap" style={{ marginBottom: 10 }}>{t.attachments.map((a) => <AttachmentView key={a.id} a={a} />)}</div>}
        {involved ? <AttachmentInput value={newAtt} onChange={setNewAtt} /> : t.attachments.length === 0 && <span className="muted">Нет вложений</span>}
      </div>

      <div className="section">
        <h3><MessageSquare size={16} />Комментарии</h3>
        {t.comments.length === 0 && <div className="muted small">Пока нет комментариев. Здесь можно уточнить детали с ответственным.</div>}
        {t.comments.map((c) => (
          <div key={c.id} className={`comment ${c.kind ?? ''}`}>
            <Avatar user={L.user(c.authorId)} size={28} />
            <div className="grow">
              <div className="small"><b>{L.user(c.authorId)?.name}</b> <span className="muted">· {fmtAgo(c.at)}{c.kind === 'return' ? ' · возврат на доработку' : c.kind === 'result' ? ' · результат' : ''}</span></div>
              <div className="comment-body">{c.text}</div>
            </div>
          </div>
        ))}
        <form className="col" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); if (run(() => addComment(t.id, comment), 'Комментарий отправлен')) setComment(''); }}>
          <Textarea rows={2} placeholder="Написать комментарий…" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Комментарий" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (run(() => addComment(t.id, comment), 'Комментарий отправлен')) setComment(''); } }} />
          <div><Button type="submit" size="sm" icon={Send} disabled={!comment.trim()}>Отправить</Button></div>
        </form>
      </div>

      <div className="section">
        <h3><History size={16} />История изменений</h3>
        <div className="timeline">
          {[...t.history].reverse().map((h, i) => (
            <div key={i}><b>{L.user(h.userId)?.name}</b> — {h.text}<div className="small muted">{fmtStamp(h.at)}</div></div>
          ))}
        </div>
      </div>

      {submitOpen && <SubmitModal task={t} onClose={() => setSubmit(false)} />}
      {returnOpen && <ReturnModal task={t} onClose={() => setReturn(false)} />}
      {cancelOpen && <CancelModal task={t} onClose={() => setCancel(false)} />}
    </Drawer>
  );
}
