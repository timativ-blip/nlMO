import { useEffect, useState } from 'react';
import { BACKEND, FUNCTIONS_URL } from '../lib/supabase';
import { isDistrictDirectory, type DistrictDirectory } from '../../supabase/functions/_shared/district-directory';

let cached: DistrictDirectory | null = null;
let pending: Promise<DistrictDirectory> | null = null;
async function loadDirectory() {
  if (!pending) pending = (async () => {
    const response = await fetch(`${FUNCTIONS_URL}/media-groups?view=directory`, { cache: 'no-store', signal: AbortSignal.timeout(18000) });
    if (!response.ok) throw new Error('Не удалось обновить справочник.');
    const value: unknown = await response.json();
    if (!isDistrictDirectory(value)) throw new Error('Некорректный справочник.');
    return cached = value;
  })().finally(() => { pending = null; });
  return pending;
}

export function useDistrictDirectory() {
  const [data, setData] = useState(cached), [error, setError] = useState(false), [loading, setLoading] = useState(BACKEND && !cached);
  useEffect(() => {
    if (!BACKEND) return;
    let active = true;
    const refresh = async () => {
      try { const value = await loadDirectory(); if (active) { setData(value); setError(value.sourceStatus === 'stale'); } }
      catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh(); const timer = setInterval(visible, 60000); document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return { data, error, loading };
}
