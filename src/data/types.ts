export type Role = 'head' | 'coordinator' | 'staff' | 'member';
// Роль в команде — что видят коллеги; уровень доступа (role) определяет права.
export type TeamRole = 'head' | 'developer' | 'deputy' | 'coordinator' | 'deputy_coordinator' | 'staff' | 'media' | 'member' | 'party_member';
export const TEAM_ROLES: { key: TeamRole; label: string; access: Role; hint: string }[] = [
  { key: 'head', label: 'Руководитель области', access: 'head', hint: 'все права' },
  { key: 'developer', label: 'Разработчик', access: 'head', hint: 'права руководителя' },
  { key: 'deputy', label: 'Заместитель руководителя', access: 'head', hint: 'права руководителя' },
  { key: 'coordinator', label: 'Координатор округа', access: 'coordinator', hint: 'свой округ' },
  { key: 'deputy_coordinator', label: 'Заместитель координатора', access: 'coordinator', hint: 'права координатора в своём округе' },
  { key: 'staff', label: 'Штаб', access: 'staff', hint: 'вся область, без подтверждения результатов' },
  { key: 'media', label: 'Медиа-штаб', access: 'staff', hint: 'права штаба' },
  { key: 'member', label: 'Участник команды', access: 'member', hint: 'свои задачи' },
  { key: 'party_member', label: 'Член партии', access: 'member', hint: 'права участника' },
];
export const teamRoleOf = (u: { role: Role; title?: TeamRole | null }): TeamRole => u.title ?? u.role;
export const roleLabel = (u: { role: Role; title?: TeamRole | null }) => TEAM_ROLES.find((r) => r.key === teamRoleOf(u))?.label ?? ROLE_LABEL[u.role];
export type BirthdayVisibility = 'all' | 'district' | 'hidden';

export interface User {
  id: string;
  name: string;
  photo?: string; // dataURL
  role: Role; // уровень доступа
  title?: TeamRole | null; // роль в команде (по умолчанию совпадает с уровнем доступа)
  position: string;
  districtId: string | null;
  email: string;
  phone: string;
  telegram?: string;
  birthday?: string; // YYYY-MM-DD
  birthdayVisibility: BirthdayVisibility;
  active: boolean;
  pending?: boolean; // заявка после самостоятельной регистрации ждёт одобрения
}

export interface District {
  id: string;
  name: string;
  coordinatorId: string | null;
  num?: number; // номер избирательного округа (118–129)
  cities?: string[]; // городские округа (ТИК) в составе
  coordinatorName?: string | null; // координатор по таблице, если у него ещё нет учётной записи
  pos?: [number, number];
}

export type TaskStatus = 'new' | 'in_progress' | 'review' | 'done' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export interface Attachment {
  id: string;
  name: string;
  kind: 'link' | 'file' | 'photo';
  url: string; // ссылка или dataURL
  size?: number;
}

export interface Comment {
  id: string;
  authorId: string;
  text: string;
  at: string;
  kind?: 'comment' | 'return' | 'result' | 'system';
}

export interface HistoryItem {
  at: string;
  userId: string;
  text: string;
}

export interface TaskResult {
  text: string;
  value?: number;
  attachments: Attachment[];
  submittedAt: string; // ISO
  submittedDate: string; // YYYY-MM-DD (МСК) — для «вовремя»
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  coAssigneeIds: string[];
  districtId: string;
  authorId: string;
  due: string;
  priority: Priority;
  status: TaskStatus;
  checklist: { id: string; text: string; done: boolean }[];
  comments: Comment[];
  attachments: Attachment[];
  eventId?: string | null;
  metricId?: string | null;
  result?: TaskResult | null;
  returnedAt?: string | null; // последний возврат на доработку
  confirmedAt?: string | null; // YYYY-MM-DD
  confirmedBy?: string | null;
  createdAt: string;
  history: HistoryItem[];
}

export type EventType = 'event' | 'meeting' | 'training';

export interface CalEvent {
  id: string;
  title: string;
  type: EventType;
  start: string; // YYYY-MM-DDTHH:mm
  end: string;
  place: string;
  link: string;
  ownerId: string;
  participantIds: string[];
  districtId: string | null; // null — вся область
  description: string;
  cancelled?: boolean;
  history: HistoryItem[];
}

export type ReportStatus = 'draft' | 'sent' | 'returned' | 'accepted';

export interface Report {
  id: string;
  districtId: string;
  weekStart: string;
  status: ReportStatus;
  conclusions: string;
  problems: string;
  plan: string;
  returnComment?: string;
  updatedAt: string;
  history: HistoryItem[];
}

/** Ежедневный отчёт о работе (штаб, медиа-штаб, координаторы и заместители) */
export interface DailyReport {
  id: string;
  userId: string;
  day: string; // YYYY-MM-DD (МСК)
  done: string;
  plan: string;
  problems: string;
  updatedAt: string;
}
/** Кто обязан сдавать ежедневный отчёт */
export const DAILY_REQUIRED: TeamRole[] = ['staff', 'media', 'coordinator', 'deputy_coordinator', 'deputy'];

export interface Metric {
  id: string;
  name: string;
  unit: string;
  monthlyPlan: number; // план на округ в месяц по умолчанию
  districtPlans?: Record<string, number>; // свой месячный план для отдельных округов
  weight: number; // вес в выполнении плана
  description: string;
}

export interface Notification {
  id: string;
  userId: string;
  text: string;
  at: string;
  read: boolean;
  link: string;
  kind: 'assign' | 'comment' | 'review' | 'event' | 'report' | 'deadline' | 'media';
}

export interface AuditItem {
  at: string;
  userId: string;
  entity: string;
  entityId: string;
  text: string;
}

export interface Weights {
  personCompletion: number;
  personOnTime: number;
  personVolume: number;
  districtPlan: number;
  districtCompletion: number;
  districtOnTime: number;
  priority: Record<Priority, number>;
  lateFactor: number; // множитель баллов за результат после срока
  minTasks: number; // минимум задач в периоде для оценки
}

export interface UiPrefs {
  period: import('../lib/date').PeriodKey;
  districtId: string; // 'all' или id
  taskView: 'list' | 'kanban';
  notify: Record<Notification['kind'], boolean>;
}

/** Шаблон медиа-штаба «что публикуем»: уходит всей команде в колокольчик и Telegram */
export interface Brief { id: string; authorId: string; day: string; title: string; text: string; link?: string; hashtags?: string; createdAt: string }
/** План постов «Пиши-Делись» в месяц: по умолчанию на округ и свой для отдельных округов */
export interface PdPlan { monthly: number; districts: Record<string, number> }

export interface State {
  version: number;
  seededAt: string;
  users: User[];
  districts: District[];
  tasks: Task[];
  events: CalEvent[];
  reports: Report[];
  dailyReports: DailyReport[];
  briefs: Brief[];
  pdPlan?: PdPlan;
  metrics: Metric[];
  notifications: Notification[];
  audit: AuditItem[];
  weights: Weights;
  ui: UiPrefs;
  session: { userId: string };
  extras?: { telegramBot?: string; telegramLinked?: boolean };
}

export const ROLE_LABEL: Record<Role, string> = {
  head: 'Руководитель области',
  coordinator: 'Координатор округа',
  staff: 'Штаб',
  member: 'Участник команды',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Выполнена',
  cancelled: 'Отменена',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочный',
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  event: 'Мероприятие',
  meeting: 'Встреча',
  training: 'Обучение',
};

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  draft: 'Черновик',
  sent: 'Отправлен',
  returned: 'Возвращён',
  accepted: 'Принят',
};
