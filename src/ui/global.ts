// Глобальные панели (задача, создание задачи, расшифровка цифры), доступные с любого экрана.
import { useSyncExternalStore } from 'react';
import type { Task } from '../data/types';
import type { TaskInput } from '../data/store';

export interface RecordsSpec { title: string; rule?: string; tasks: Task[]; cellValue?: (t: Task) => string }
type GlobalState = { taskId: string | null; newTask: Partial<TaskInput> | null; records: RecordsSpec | null; eventId: string | null; newEvent: { date?: string; districtId?: string } | null };

let g: GlobalState = { taskId: null, newTask: null, records: null, eventId: null, newEvent: null };
const subs = new Set<() => void>();
const set = (p: Partial<GlobalState>) => { g = { ...g, ...p }; subs.forEach((f) => f()); };

export const openTask = (id: string | null) => set({ taskId: id, records: null });
export const openNewTask = (prefill: Partial<TaskInput> = {}) => set({ newTask: prefill });
export const closeNewTask = () => set({ newTask: null });
export const openRecords = (r: RecordsSpec | null) => set({ records: r });
export const openEvent = (id: string | null) => set({ eventId: id });
export const openNewEvent = (p: GlobalState['newEvent']) => set({ newEvent: p });

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useGlobal = () => useSyncExternalStore(subscribe, () => g);
