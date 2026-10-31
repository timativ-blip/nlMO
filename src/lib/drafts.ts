export interface DraftRecord<T> {
  version: 1;
  at: number;
  value: T;
  revision: string;
}
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const draftKey = (project: string, user: string, form: string) =>
  ['kc-draft-v1', project, user, form].map(encodeURIComponent).join(':');
const MAX_AGE = 30 * 864e5;

function compatible(value: unknown, sample: unknown): boolean {
  if (sample === null) return value === null || typeof value === 'string';
  if (Array.isArray(sample)) return Array.isArray(value);
  if (sample && typeof sample === 'object')
    return (
      !!value &&
      typeof value === 'object' &&
      Object.entries(sample).every(([key, item]) => compatible((value as Record<string, unknown>)[key], item))
    );
  return typeof value === typeof sample;
}

export function readDraft<T>(key: string, initial: T, storage: DraftStorage, now = Date.now()): DraftRecord<T> | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as DraftRecord<T>;
    if (
      record.version !== 1 ||
      !Number.isFinite(record.at) ||
      record.at > now + 60000 ||
      now - record.at > MAX_AGE ||
      !compatible(record.value, initial)
    )
      return null;
    return record;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T, revision: string, storage: DraftStorage): number {
  const at = Date.now();
  storage.setItem(key, JSON.stringify({ version: 1, at, value, revision } satisfies DraftRecord<T>));
  return at;
}

/** A late server acknowledgement may only remove the version that was submitted. */
export function clearSavedDraft<T>(key: string, submitted: T, storage: DraftStorage): boolean {
  const raw = storage.getItem(key);
  if (raw && JSON.stringify(JSON.parse(raw).value) !== JSON.stringify(submitted)) return false;
  storage.removeItem(key);
  return true;
}
