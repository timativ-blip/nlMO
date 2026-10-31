import { Copy, Pause, Play, Plus, Repeat, Save } from 'lucide-react';
import { useState } from 'react';
import {
  launchTaskWorkflow,
  loadWorkflowData,
  saveTaskTemplate,
  setScheduleEnabled,
  useAppState,
  useWorkflowStatus,
  uid,
} from '../data/store';
import { canAssignIn, isManager } from '../data/perm';
import { blankWorkflowBody } from '../data/workflow';
import type { TaskSchedule, TaskTemplate, WorkflowBody, WorkflowResult } from '../data/workflow-types';
import { PRIORITY_LABEL, type Priority } from '../data/types';
import { addDays, fmtDate, todayISO } from '../lib/date';
import { openTask } from '../ui/global';
import { useMe } from '../ui/hooks';
import { DraftNotice, useDraft } from '../ui/drafts';
import { Button, Empty, Field, Input, Modal, Select, Tabs, Textarea, toast } from '../ui/kit';

type Tab = 'launch' | 'templates' | 'schedules';
const clean = (body: WorkflowBody): WorkflowBody => ({
  ...body,
  title: body.title.trim(),
  description: body.description.trim(),
  checklist: body.checklist.map((s) => s.trim()).filter(Boolean),
  links: body.links.flatMap((s) => s.split(/\s+/)).filter(Boolean),
});

function BodyFields({ body, onChange }: { body: WorkflowBody; onChange: (body: WorkflowBody) => void }) {
  const s = useAppState();
  const set = (patch: Partial<WorkflowBody>) => onChange({ ...body, ...patch });
  return (
    <>
      <Field label="Что нужно сделать" required>
        <Input value={body.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Описание и ожидаемый результат">
        <Textarea rows={3} value={body.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <div className="grid g-2">
        <Field label="Приоритет">
          <Select
            value={body.priority}
            onChange={(e) => set({ priority: e.target.value as Priority })}
            options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Показатель">
          <Select
            value={body.metricId ?? ''}
            onChange={(e) => set({ metricId: e.target.value || null })}
            options={[{ value: '', label: 'Без показателя' }, ...s.metrics.map((m) => ({ value: m.id, label: m.name }))]}
          />
        </Field>
      </div>
      <Field label="Мероприятие">
        <Select
          value={body.eventId ?? ''}
          onChange={(e) => set({ eventId: e.target.value || null })}
          options={[
            { value: '', label: 'Без мероприятия' },
            ...s.events.filter((event) => !event.cancelled).map((event) => ({ value: event.id, label: event.title })),
          ]}
        />
      </Field>
      <Field label="Чек-лист" hint="Каждый пункт с новой строки">
        <Textarea rows={3} value={body.checklist.join('\n')} onChange={(e) => set({ checklist: e.target.value.split('\n') })} />
      </Field>
      <Field label="Ссылки">
        <Textarea rows={2} value={body.links.join('\n')} onChange={(e) => set({ links: e.target.value.split('\n') })} />
      </Field>
    </>
  );
}

export default function TaskWorkflows({ initial = 'launch', onClose }: { initial?: Tab; onClose: () => void }) {
  const s = useAppState(),
    me = useMe(),
    status = useWorkflowStatus();
  const [tab, setTab] = useState<Tab>(initial);
  const [editor, setEditor] = useState<TaskTemplate | 'new' | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [initialDraft] = useState(() => ({
    requestId: crypto.randomUUID(),
    body: blankWorkflowBody(),
    targets: [] as { districtId: string; assigneeId: string }[],
    due: addDays(todayISO(), 3),
    repeat: 'none' as 'none' | 'weekly' | 'monthly',
    start: todayISO(),
    time: '09:00',
    deadlineDays: 3,
  }));
  const draft = useDraft('district-workflow', initialDraft);
  const v = draft.value;
  const set = (patch: Partial<typeof v>) => {
    draft.set((old) => ({ ...old, ...patch, requestId: crypto.randomUUID() }));
    setError('');
    setResult(null);
  };
  const districts = s.districts.filter((d) => canAssignIn(me, d.id));
  const defaultTarget = (districtId: string) => {
    const d = s.districts.find((d) => d.id === districtId);
    const coordinator =
      s.users.find((u) => u.id === d?.coordinatorId && u.active && !u.pending) ??
      s.users.find((u) => u.role === 'coordinator' && u.districtId === districtId && u.active && !u.pending);
    return { districtId, assigneeId: coordinator?.id ?? '' };
  };
  const useTemplate = (template: TaskTemplate) => {
    set({
      body: structuredClone(template.body),
      due: addDays(todayISO(), template.deadlineDays),
      deadlineDays: template.deadlineDays,
    });
    setTab('launch');
  };
  const launch = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await launchTaskWorkflow({
        requestId: v.requestId,
        body: clean(v.body),
        targets: v.targets,
        due: v.repeat === 'none' ? v.due : addDays(v.start, v.deadlineDays),
        repeat: v.repeat === 'none' ? null : { frequency: v.repeat, start: v.start, time: v.time, deadlineDays: v.deadlineDays },
      });
      draft.confirm(v);
      setResult(saved);
      toast(saved.tasks.length ? `Создано отдельных задач: ${saved.tasks.length}` : 'Расписание сохранено');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (job: TaskSchedule) => {
    setBusy(true);
    try {
      await setScheduleEnabled(job.id, !job.enabled);
      toast(job.enabled ? 'Повторение приостановлено' : 'Повторение включено');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copySchedule = (job: TaskSchedule) => {
    set({
      body: structuredClone(job.body),
      targets: job.targets,
      repeat: job.rule.frequency,
      start: todayISO(),
      time: job.rule.time,
      deadlineDays: job.rule.deadlineDays,
    });
    setTab('launch');
  };
  if (editor) return <TemplateEditor template={editor === 'new' ? null : editor} onClose={() => setEditor(null)} />;
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Поручения, шаблоны и повторения"
      width={820}
      footer={
        <>
          <Button disabled={busy} variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          {tab === 'launch' && !result && (
            <Button variant="primary" disabled={busy || !status.ready} onClick={launch}>
              {busy
                ? 'Сохраняю…'
                : v.repeat === 'none'
                  ? `Создать задач: ${v.targets.length}`
                  : 'Создать повторяющееся поручение'}
            </Button>
          )}
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        <Tabs
          value={tab}
          onChange={(value) => {
            setTab(value);
            setResult(null);
            setError('');
          }}
          tabs={[
            { value: 'launch', label: 'По округам' },
            { value: 'templates', label: 'Шаблоны' },
            { value: 'schedules', label: 'Повторения' },
          ]}
        />
        {!status.ready && (
          <div className="callout warn" role="status">
            <span className="grow">{status.loading ? 'Подключаю инструменты…' : status.error}</span>
            <Button size="sm" disabled={status.loading} onClick={() => loadWorkflowData()}>
              Повторить
            </Button>
          </div>
        )}
        {error && (
          <div className="callout danger" role="alert">
            {error}
          </div>
        )}
        {tab === 'launch' &&
          (result ? (
            <div className="col" style={{ gap: 12 }}>
              <h2>{result.tasks.length ? `Создано задач: ${result.tasks.length}` : 'Расписание сохранено'}</h2>
              {result.schedule && (
                <p>
                  Следующий запуск: {fmtDate(result.schedule.nextRun)}, {result.schedule.rule.time} МСК. Повторения выполняются и
                  при закрытом сайте.
                </p>
              )}
              {result.tasks.map((task) => (
                <Button
                  key={task.id}
                  onClick={() => {
                    onClose();
                    openTask(task.id);
                  }}
                >
                  {s.districts.find((d) => d.id === task.districtId)?.name} ·{' '}
                  {s.users.find((u) => u.id === task.assigneeId)?.name}
                </Button>
              ))}
              <Button
                onClick={() => {
                  draft.clear({ ...v, requestId: crypto.randomUUID(), body: blankWorkflowBody(), targets: [] });
                  setResult(null);
                }}
              >
                Новое поручение
              </Button>
            </div>
          ) : (
            <>
              <DraftNotice draft={draft} />
              <p className="small muted">
                Каждый выбранный округ получит отдельную обычную задачу со своим ответственным, проверкой результата и учётом в
                отчётах.
              </p>
              <BodyFields body={v.body} onChange={(body) => set({ body })} />
              <div className="row wrap">
                <b className="grow">Кому поручить</b>
                <Button
                  size="sm"
                  onClick={() =>
                    set({ targets: districts.map((d) => v.targets.find((t) => t.districtId === d.id) ?? defaultTarget(d.id)) })
                  }
                >
                  Выбрать все
                </Button>
                <Button size="sm" variant="ghost" onClick={() => set({ targets: [] })}>
                  Снять выбор
                </Button>
              </div>
              <div className="workflow-targets">
                {districts.map((district) => {
                  const selected = v.targets.find((t) => t.districtId === district.id);
                  const people = s.users.filter(
                    (u) => u.active && !u.pending && (u.districtId === district.id || (isManager(me) && u.districtId === null)),
                  );
                  return (
                    <div key={district.id} className="workflow-target">
                      <label className="row">
                        <input
                          type="checkbox"
                          checked={!!selected}
                          onChange={(e) =>
                            set({
                              targets: e.target.checked
                                ? [...v.targets, defaultTarget(district.id)]
                                : v.targets.filter((t) => t.districtId !== district.id),
                            })
                          }
                        />
                        {district.name}
                      </label>
                      {selected && (
                        <Select
                          aria-label={`Ответственный: ${district.name}`}
                          value={selected.assigneeId}
                          onChange={(e) =>
                            set({
                              targets: v.targets.map((t) =>
                                t.districtId === district.id ? { ...t, assigneeId: e.target.value } : t,
                              ),
                            })
                          }
                          options={[
                            { value: '', label: 'Выберите ответственного' },
                            ...people.map((u) => ({ value: u.id, label: u.name })),
                          ]}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <Field label="Повторять постановку">
                <Select
                  value={v.repeat}
                  onChange={(e) => set({ repeat: e.target.value as typeof v.repeat })}
                  options={[
                    { value: 'none', label: 'Один раз' },
                    { value: 'weekly', label: 'Каждую неделю' },
                    { value: 'monthly', label: 'Каждый месяц' },
                  ]}
                />
              </Field>
              {v.repeat === 'none' ? (
                <Field label="Срок выполнения" required>
                  <Input type="date" min={todayISO()} value={v.due} onChange={(e) => set({ due: e.target.value })} />
                </Field>
              ) : (
                <>
                  <div className="grid g-2">
                    <Field label="Первый запуск" required>
                      <Input type="date" min={todayISO()} value={v.start} onChange={(e) => set({ start: e.target.value })} />
                    </Field>
                    <Field label="Время постановки (МСК)">
                      <Input type="time" value={v.time} onChange={(e) => set({ time: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Дней на выполнение после постановки">
                    <Input
                      type="number"
                      min={0}
                      max={365}
                      value={v.deadlineDays}
                      onChange={(e) => set({ deadlineDays: +e.target.value })}
                    />
                  </Field>
                  <p className="small muted">
                    Повторение привязано к первому дню. Если в месяце нет такого числа, запуск произойдёт в последний день месяца.
                    После длительного перерыва создастся один текущий выпуск; срок будет отсчитан от фактической постановки.
                  </p>
                </>
              )}
            </>
          ))}
        {tab === 'templates' && (
          <>
            <div className="row">
              <span className="grow small muted">Личные шаблоны и шаблоны команды</span>
              <Button icon={Plus} disabled={!status.ready} onClick={() => setEditor('new')}>
                Новый шаблон
              </Button>
            </div>
            {!(s.taskTemplates ?? []).some((t) => !t.archived && (t.ownerId === me.id || t.shared || me.role === 'head')) && (
              <Empty
                icon={Copy}
                title="Шаблонов пока нет"
                text="Сохраните типовое поручение с описанием, чек-листом и сроком выполнения."
              />
            )}
            {(s.taskTemplates ?? [])
              .filter((t) => !t.archived && (t.ownerId === me.id || t.shared || me.role === 'head'))
              .map((t) => (
                <div className="card card-pad col" key={t.id}>
                  <b>{t.name}</b>
                  <span className="small muted">
                    {t.shared ? 'Общий' : 'Личный'} · срок выполнения {t.deadlineDays} дн.
                  </span>
                  <div className="row wrap">
                    <Button onClick={() => useTemplate(t)}>Использовать</Button>
                    {(t.ownerId === me.id || me.role === 'head') && (
                      <Button variant="ghost" onClick={() => setEditor(t)}>
                        Изменить
                      </Button>
                    )}
                  </div>
                </div>
              ))}
          </>
        )}
        {tab === 'schedules' && (
          <>
            <p className="small muted">
              Можно приостановить будущие выпуски. Уже созданные задачи продолжат работать независимо. Чтобы изменить состав
              поручения, приостановите расписание и создайте похожее.
            </p>
            {!(s.taskSchedules ?? []).some((j) => j.ownerId === me.id || me.role === 'head') && (
              <Empty
                icon={Repeat}
                title="Повторений пока нет"
                text="Во вкладке «По округам» выберите еженедельную или ежемесячную постановку."
              />
            )}
            {(s.taskSchedules ?? [])
              .filter((j) => j.ownerId === me.id || me.role === 'head')
              .map((job) => (
                <div key={job.id} className="card card-pad col">
                  <b>{job.body.title}</b>
                  <span className="small muted">
                    {job.rule.frequency === 'weekly' ? 'Каждую неделю' : 'Каждый месяц'} · {job.targets.length} округов ·{' '}
                    {job.enabled ? `следующий запуск ${fmtDate(job.nextRun)}, ${job.rule.time} МСК` : 'приостановлено'}
                  </span>
                  {job.lastError && <div className="callout danger">{job.lastError}</div>}
                  <div className="row wrap">
                    <Button disabled={busy || !status.ready} icon={job.enabled ? Pause : Play} onClick={() => toggle(job)}>
                      {job.enabled ? 'Приостановить' : 'Возобновить'}
                    </Button>
                    <Button icon={Copy} variant="ghost" onClick={() => copySchedule(job)}>
                      Создать похожее
                    </Button>
                  </div>
                </div>
              ))}
          </>
        )}
      </div>
    </Modal>
  );
}

function TemplateEditor({ template, onClose }: { template: TaskTemplate | null; onClose: () => void }) {
  const me = useMe();
  const [newId] = useState(() => uid('tpl'));
  const draft = useDraft(
    `template:${template?.id ?? 'new'}`,
    {
      id: template?.id ?? newId,
      name: template?.name ?? '',
      body: template?.body ?? blankWorkflowBody(),
      deadlineDays: template?.deadlineDays ?? 3,
      shared: template?.shared ?? false,
    },
    template?.updatedAt ?? '',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const save = async (archived = false) => {
    if (busy) return;
    const submitted = draft.value;
    setBusy(true);
    try {
      await saveTaskTemplate({
        ...submitted,
        body: clean(submitted.body),
        archived,
      });
      draft.confirm(submitted);
      toast(archived ? 'Шаблон убран в архив' : 'Шаблон сохранён');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={template ? 'Изменить шаблон' : 'Новый шаблон'}
      width={700}
      footer={
        <>
          <Button disabled={busy} variant="ghost" onClick={onClose}>
            Назад
          </Button>
          {template && (
            <Button disabled={busy} variant="ghost" onClick={() => save(true)}>
              В архив
            </Button>
          )}
          <Button disabled={busy} variant="primary" icon={Save} onClick={() => save()}>
            Сохранить шаблон
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <DraftNotice draft={draft} />
        {error && (
          <div role="alert" className="callout danger">
            {error}
          </div>
        )}
        <Field label="Название шаблона" required>
          <Input value={draft.value.name} onChange={(e) => draft.set((v) => ({ ...v, name: e.target.value }))} />
        </Field>
        <BodyFields body={draft.value.body} onChange={(body) => draft.set((v) => ({ ...v, body }))} />
        <Field label="Дней на выполнение">
          <Input
            type="number"
            min={0}
            max={365}
            value={draft.value.deadlineDays}
            onChange={(e) => draft.set((v) => ({ ...v, deadlineDays: +e.target.value }))}
          />
        </Field>
        {isManager(me) && (
          <label className="row">
            <input
              type="checkbox"
              checked={draft.value.shared}
              onChange={(e) => draft.set((v) => ({ ...v, shared: e.target.checked }))}
            />
            Доступен команде для постановки задач
          </label>
        )}
      </div>
    </Modal>
  );
}
