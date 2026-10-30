export type Src = 'vk' | 'tg' | 'youtube' | 'tiktok' | 'instagram' | 'other';
// [дата, заголовок, канал, источник, автор, баллы, вклад, просмотры, лайки, комм., репосты, избранное, url, засчитан, причина]
export type Post = [string, string, string, Src, number, number, number, number, number, number, number, number, string, 0 | 1, string];
export interface PdData {
  groups: { id: string; num: number; name: string }[];
  people: [string, string][];
  posts: Post[];
  seasons?: Record<string, number>;
  updated: string;
}
export interface Channel { status: 'ok' | 'empty' | 'closed' | 'error' | 'nokey'; last?: string; url?: string; link?: string; about?: string }
export interface GroupRow { okrug: string; city: string; coord: string; resp: string; vk: Channel | null; tg: Channel | null }
export interface GroupsData { groups: GroupRow[]; vkEnabled: boolean; updated: string }
