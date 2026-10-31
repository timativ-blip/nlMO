import { useEffect, useRef, useState } from 'react';
import { AUTH_STORAGE_KEY, BACKEND } from '../lib/supabase';
import { clearSavedDraft, draftKey, readDraft, writeDraft } from '../lib/drafts';
import { useMe } from './hooks';
import { Button } from './kit';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function useDraft<T>(form: string, initial: T, revision = '') {
  const me = useMe();
  const key = draftKey(BACKEND ? AUTH_STORAGE_KEY : 'demo', me.id, form);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const load = () => {
    let record = null;
    try {
      record = readDraft(key, initial, localStorage);
    } catch {
      /* Storage can be disabled. */
    }
    return {
      key,
      value: record?.value ?? initial,
      baseline: initial,
      revision,
      at: record?.at ?? 0,
      restored: !!record && !same(record.value, initial),
      error: '',
      conflict: !!record && !!record.revision && record.revision !== revision,
    };
  };
  const [state, update] = useState(load);
  const current = useRef(state);
  if (state.key !== key) {
    current.current = load();
    update(current.current);
  } else current.current = state;
  useEffect(() => {
    const previous = current.current;
    if (previous.key !== key || (same(previous.baseline, initialRef.current) && previous.revision === revision)) return;
    // Optimistic server state can echo this text before the request succeeds.
    // Keep its original baseline until confirm(), including on a failed-save rollback.
    const dirty = previous.at > 0 || !same(previous.value, previous.baseline);
    const next = {
      ...previous,
      revision,
      ...(dirty
        ? { conflict: previous.conflict || previous.revision !== revision }
        : { baseline: initialRef.current, value: initialRef.current, conflict: false }),
    };
    current.current = next;
    update(next);
  }, [key, revision, JSON.stringify(initial)]);
  const set = (change: T | ((previous: T) => T)) => {
    const previous = current.current;
    const value = typeof change === 'function' ? (change as (v: T) => T)(previous.value) : change;
    let at = previous.at,
      error = '';
    try {
      if (same(value, previous.baseline)) {
        localStorage.removeItem(key);
        at = 0;
      } else at = writeDraft(key, value, revision, localStorage);
    } catch {
      error = 'Не удалось сохранить черновик на устройстве. Не закрывайте форму до отправки.';
    }
    const next = { ...previous, value, at, error };
    current.current = next;
    update(next);
  };
  const clear = (value: T = current.current.value) => {
    let error = '';
    try {
      localStorage.removeItem(key);
    } catch {
      error = 'Не удалось очистить черновик на устройстве.';
    }
    const next = { ...current.current, value, baseline: value, revision, at: 0, restored: false, conflict: false, error };
    current.current = next;
    update(next);
  };
  const confirm = (submitted: T, resetTo?: T) => {
    let removed = false,
      error = '';
    try {
      removed = clearSavedDraft(key, submitted, localStorage);
    } catch {
      error = 'Не удалось очистить отправленную версию черновика на устройстве.';
    }
    const previous = current.current;
    if (previous.key !== key) return false;
    const unchanged = removed && same(previous.value, submitted);
    const value = unchanged ? (resetTo ?? submitted) : previous.value;
    const next = {
      ...previous,
      value,
      baseline: unchanged ? value : submitted,
      ...(unchanged ? { at: 0, restored: false, conflict: false } : {}),
      error: error || previous.error,
    };
    current.current = next;
    update(next);
    return unchanged;
  };
  return {
    value: current.current.value,
    set,
    clear,
    confirm,
    discard: () => clear(initialRef.current),
    restored: current.current.restored,
    dirty: !same(current.current.value, current.current.baseline),
    at: current.current.at,
    error: current.current.error,
    conflict: current.current.conflict,
  };
}

export function DraftNotice({
  draft,
}: {
  draft: { dirty: boolean; restored: boolean; error: string; conflict: boolean; discard: () => void };
}) {
  if (draft.error)
    return (
      <div className="callout danger" role="status">
        {draft.error}
      </div>
    );
  if (!draft.dirty) return null;
  return (
    <div className="draft-notice" role="status">
      <span>
        {draft.conflict
          ? 'Данные на сервере изменились. Ваш текст сохранён отдельно — проверьте его перед отправкой.'
          : draft.restored
            ? 'Восстановлен незавершённый черновик с этого устройства.'
            : 'Черновик сохранён на этом устройстве.'}
      </span>
      <Button size="sm" variant="ghost" onClick={draft.discard}>
        Удалить черновик
      </Button>
    </div>
  );
}
