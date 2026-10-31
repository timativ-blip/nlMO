import type { Priority } from './types';
export interface WorkflowBody {
  title: string;
  description: string;
  priority: Priority;
  checklist: string[];
  links: string[];
  metricId: string | null;
  eventId: string | null;
}
export interface TaskTarget {
  districtId: string;
  assigneeId: string;
}
export type Frequency = 'weekly' | 'monthly';
export interface RepeatRule {
  frequency: Frequency;
  start: string;
  time: string;
  deadlineDays: number;
}
export interface TaskTemplate {
  id: string;
  ownerId: string;
  name: string;
  body: WorkflowBody;
  deadlineDays: number;
  shared: boolean;
  archived: boolean;
  updatedAt: string;
}
export interface TaskSchedule {
  id: string;
  ownerId: string;
  body: WorkflowBody;
  targets: TaskTarget[];
  rule: RepeatRule;
  nextRun: string;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  lastError?: string;
}
export interface MediaMatch {
  id: string;
  sourceName: string;
  groupId: string;
  userId: string | null;
  ownerId: string;
  active: boolean;
  updatedAt: string;
}
export interface WorkflowLaunch {
  requestId: string;
  body: WorkflowBody;
  targets: TaskTarget[];
  due: string;
  repeat: RepeatRule | null;
}
export interface WorkflowResult {
  tasks: import('./types').Task[];
  schedule: TaskSchedule | null;
}
