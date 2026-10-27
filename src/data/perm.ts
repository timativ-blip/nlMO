// Правила доступа. В демо они проверяются в каждом действии хранилища;
// в рабочей версии те же правила дублируются политиками RLS (supabase/schema.sql).
import type { CalEvent, Report, State, Task, User } from './types';

export const isManager = (u: User) => u.role === 'head' || u.role === 'staff';
export const isInvolved = (u: User, t: Task) => t.assigneeId === u.id || t.coAssigneeIds.includes(u.id) || t.authorId === u.id;

export function canSeeTask(u: User, t: Task) {
  if (isManager(u)) return true;
  if (u.role === 'coordinator' && t.districtId === u.districtId) return true;
  return isInvolved(u, t);
}
export const canCreateTask = (u: User) => u.role !== 'member';
export function canAssignIn(u: User, districtId: string) {
  if (isManager(u)) return true;
  return u.role === 'coordinator' && u.districtId === districtId;
}
export function canEditTask(u: User, t: Task) {
  if (t.status === 'done') return u.role === 'head';
  if (isManager(u)) return true;
  if (u.role === 'coordinator' && t.districtId === u.districtId) return true;
  return t.authorId === u.id;
}
export const canStart = (u: User, t: Task) => t.status === 'new' && (t.assigneeId === u.id || t.coAssigneeIds.includes(u.id) || canEditTask(u, t));
export const canSubmit = (u: User, t: Task) => (t.status === 'new' || t.status === 'in_progress') && (t.assigneeId === u.id || t.coAssigneeIds.includes(u.id));
export function canReview(u: User, t: Task) {
  if (t.status !== 'review') return false;
  if (t.assigneeId === u.id) return false; // нельзя принимать свой результат
  if (u.role === 'head') return true;
  return u.role === 'coordinator' && u.districtId === t.districtId;
}
export const canComment = (u: User, t: Task) => canSeeTask(u, t);

export function canSeeEvent(u: User, e: CalEvent) {
  if (isManager(u)) return true;
  // Общеобластные события видны участникам только если их пригласили
  if (u.role === 'member') return e.participantIds.includes(u.id) || e.ownerId === u.id || (e.districtId !== null && e.districtId === u.districtId);
  return e.districtId === null || e.districtId === u.districtId || e.participantIds.includes(u.id) || e.ownerId === u.id;
}
export const canCreateEvent = (u: User) => u.role !== 'member';
export function canEditEvent(u: User, e: CalEvent) {
  if (isManager(u)) return true;
  if (e.ownerId === u.id) return true;
  return u.role === 'coordinator' && e.districtId === u.districtId;
}

export function canSeeReport(u: User, r: Report) {
  if (isManager(u)) return true;
  if (u.role === 'coordinator') return r.districtId === u.districtId;
  return r.districtId === u.districtId && r.status === 'accepted';
}
export function canEditReport(u: User, r: Report) {
  if (r.status === 'sent' || r.status === 'accepted') return false;
  return u.role === 'head' || (u.role === 'coordinator' && u.districtId === r.districtId);
}
export const canReviewReport = (u: User, r: Report) => r.status === 'sent' && u.role === 'head';
export const canEditWeights = (u: User) => u.role === 'head';
export const canImport = (u: User) => u.role !== 'member';
/** Роль и доступ: руководство — для всех; координатор — для участников своего округа (не для себя). */
export const canManageUser = (actor: User, target: User) =>
  actor.role === 'head' || (actor.role === 'coordinator' && actor.id !== target.id && target.role === 'member' && !!actor.districtId && target.districtId === actor.districtId);
export const canEditUser = (actor: User, target: User) => actor.id === target.id || actor.role === 'head';

export function canSeeBirthday(viewer: User, u: User) {
  if (!u.birthday) return false;
  if (viewer.id === u.id) return true;
  if (u.birthdayVisibility === 'all') return true;
  if (u.birthdayVisibility === 'district') return !!u.districtId && viewer.districtId === u.districtId;
  return false;
}

export const visibleTasks = (s: State, u: User) => s.tasks.filter((t) => canSeeTask(u, t));
