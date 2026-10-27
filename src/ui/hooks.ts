import { useMemo } from 'react';
import { getPeriod } from '../lib/date';
import { useAppState } from '../data/store';

export function useMe() {
  const s = useAppState();
  return s.users.find((u) => u.id === s.session.userId)!;
}

export function usePeriod() {
  const s = useAppState();
  return useMemo(() => getPeriod(s.ui.period), [s.ui.period]);
}

export function useLookup() {
  const s = useAppState();
  return useMemo(() => {
    const users = new Map(s.users.map((u) => [u.id, u]));
    const districts = new Map(s.districts.map((d) => [d.id, d]));
    const metrics = new Map(s.metrics.map((m) => [m.id, m]));
    const events = new Map(s.events.map((e) => [e.id, e]));
    return { users, districts, metrics, events, user: (id?: string | null) => (id ? users.get(id) : undefined), dname: (id?: string | null) => (id ? districts.get(id)?.name ?? '—' : 'Вся область') };
  }, [s.users, s.districts, s.metrics, s.events]);
}
