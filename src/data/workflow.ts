import { addDays, diffDays } from '../lib/date';
import * as P from './perm';
import type { State, Task, User } from './types';
import type { Frequency, TaskTarget, WorkflowBody } from './workflow-types';

export const blankWorkflowBody = (): WorkflowBody => ({
  title: '',
  description: '',
  priority: 'normal',
  checklist: [],
  links: [],
  metricId: null,
  eventId: null,
});
export function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}
export function nextOccurrence(anchor: string, frequency: Frequency, after: string): string {
  if (!validDay(anchor) || !validDay(after)) throw new Error('Укажите корректную дату повторения.');
  if (anchor > after) return anchor;
  if (frequency === 'weekly') return addDays(anchor, (Math.floor(diffDays(after, anchor) / 7) + 1) * 7);
  const day = +anchor.slice(8),
    [year, month] = after.split('-').map(Number);
  const candidate = (offset: number) => {
    const end = new Date(Date.UTC(year, month + offset, 0));
    return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, end.getUTCDate())).padStart(2, '0')}`;
  };
  return candidate(0) > after ? candidate(0) : candidate(1);
}

export function validateWorkflow(
  body: WorkflowBody,
  targets: TaskTarget[],
  due: string,
  state: State,
  actor: User,
  today: string,
) {
  if (!actor.active || actor.pending || !P.canCreateTask(actor)) throw new Error('Недостаточно прав для постановки задач.');
  if (body.title.trim().length < 3 || body.title.length > 200) throw new Error('Название должно содержать от 3 до 200 символов.');
  if (!validDay(due) || due < today) throw new Error('Срок должен быть сегодня или позже.');
  if (!['low', 'normal', 'high', 'urgent'].includes(body.priority)) throw new Error('Выберите приоритет.');
  if (
    body.description.length > 12000 ||
    body.checklist.length > 100 ||
    body.checklist.some((text) => text.length > 1000) ||
    body.links.length > 30 ||
    body.links.some((url) => url.length > 3000)
  )
    throw new Error('Сократите описание, чек-лист или список ссылок.');
  if (!targets.length || targets.length > 100 || new Set(targets.map((t) => t.districtId)).size !== targets.length)
    throw new Error('Выберите округа без повторений.');
  if (body.links.some((url) => !/^https?:\/\//i.test(url))) throw new Error('Ссылки должны начинаться с https:// или http://.');
  if (body.metricId && !state.metrics.some((m) => m.id === body.metricId)) throw new Error('Связанный показатель не найден.');
  for (const target of targets) {
    if (!P.canAssignIn(actor, target.districtId)) throw new Error('Нельзя поставить задачу в чужой округ.');
    if (!state.districts.some((d) => d.id === target.districtId)) throw new Error('Округ не найден.');
    const user = state.users.find((u) => u.id === target.assigneeId && u.active && !u.pending);
    if (
      !user ||
      (user.districtId && user.districtId !== target.districtId) ||
      (!P.isManager(actor) && user.districtId !== actor.districtId)
    )
      throw new Error('Укажите активного ответственного своего округа или штаба для каждого поручения.');
    if (
      body.eventId &&
      !state.events.some(
        (e) => e.id === body.eventId && !e.cancelled && (e.districtId === null || e.districtId === target.districtId),
      )
    )
      throw new Error('Мероприятие должно быть общим или относиться к выбранному округу.');
  }
}

export function workflowTasks(
  body: WorkflowBody,
  targets: TaskTarget[],
  due: string,
  actor: User,
  batchId: string,
  at: string,
  scheduleId?: string,
): Task[] {
  return targets.map((target) => ({
    id: `t_${batchId}_${target.districtId}`,
    batchId,
    ...(scheduleId ? { scheduleId } : {}),
    title: body.title.trim(),
    description: body.description.trim(),
    assigneeId: target.assigneeId,
    districtId: target.districtId,
    coAssigneeIds: [],
    authorId: actor.id,
    due,
    priority: body.priority,
    status: 'new',
    checklist: body.checklist
      .filter((x) => x.trim())
      .map((text, i) => ({ id: `c_${batchId}_${target.districtId}_${i}`, text: text.trim(), done: false })),
    attachments: body.links.filter(Boolean).map((url, i) => ({ id: `a_${batchId}_${i}`, kind: 'link', name: url, url })),
    metricId: body.metricId,
    eventId: body.eventId,
    comments: [],
    result: null,
    createdAt: at,
    history: [
      { at, userId: actor.id, text: scheduleId ? 'Задача создана по расписанию.' : 'Создано отдельное поручение для округа.' },
    ],
  }));
}
