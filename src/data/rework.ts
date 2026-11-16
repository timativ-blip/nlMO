export const REWORK_REASONS = {
  requirements: 'Не выполнены условия задачи',
  evidence: 'Не хватает подтверждений',
  accuracy: 'Ошибки в данных',
  completeness: 'Неполный результат',
  format: 'Нужно исправить оформление',
  other: 'Другая причина',
} as const;
export type ReworkReason = keyof typeof REWORK_REASONS;
export const isReworkReason = (value: unknown): value is ReworkReason => typeof value === 'string' && Object.hasOwn(REWORK_REASONS, value);
export const reworkReasonLabel = (value: unknown) => isReworkReason(value) ? REWORK_REASONS[value] : 'Категория не указана';
