export type { Src, Post, PdData } from '../../supabase/functions/_shared/media-timeline';
export interface Channel { status: 'ok' | 'empty' | 'closed' | 'error' | 'nokey'; last?: string; url?: string; link?: string; about?: string }
export interface GroupRow { okrug: string; city: string; coord: string; resp: string; vk: Channel | null; tg: Channel | null }
export interface GroupsData { groups: GroupRow[]; vkEnabled: boolean; updated: string }
