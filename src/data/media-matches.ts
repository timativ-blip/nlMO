import type { PdData, Post } from './media-types';
import type { MediaMatch } from './workflow-types';
import type { User } from './types';
import { nameKey } from '../lib/names';
export const mediaSourceKey = (name: string) => 'media:' + name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Explicit human matches only replace unassigned authors; the source document keeps priority. */
export function applyMediaMatches(data: PdData, matches: MediaMatch[], users: User[]): PdData {
  const active = new Map(matches.filter((m) => m.active).map((m) => [m.id, m]));
  if (!active.size) return data;
  const people: [string, string][] = data.people.map(([name, group]) => [name, group]);
  const indices = new Map<number, number>(),
    destinations = new Map<string, number>();
  data.people.forEach(([name, group], index) => {
    if (group !== 'none') return;
    const match = active.get(mediaSourceKey(name));
    if (!match) return;
    const user = match.userId ? users.find((u) => u.id === match.userId && u.active && !u.pending) : null;
    if (match.userId && !user) return;
    if (user && (user.districtId ?? 'hq') !== match.groupId) return;
    const canonical = user?.name ?? name;
    const target = `${match.groupId}:${user?.id ?? mediaSourceKey(canonical)}`;
    let destination = destinations.get(target);
    if (destination === undefined) {
      const known = data.people
        .map(([n, g], i) => ({ n, g, i }))
        .filter((p) => p.g === match.groupId && nameKey(p.n) === nameKey(canonical));
      destination = known.length === 1 ? known[0].i : index;
      destinations.set(target, destination);
      if (destination === index) people[index] = [canonical, match.groupId];
    }
    indices.set(index, destination);
  });
  return {
    ...data,
    people,
    posts: data.posts.map((p): Post => (indices.has(p[4]) ? ([...p.slice(0, 4), indices.get(p[4])!, ...p.slice(5)] as Post) : p)),
  };
}
