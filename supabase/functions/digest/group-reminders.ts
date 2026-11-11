interface Channel {
  status: string;
  last?: string;
  link?: string;
}
interface Group {
  okrug: string;
  city: string;
  vk: Channel | null;
  tg: Channel | null;
}
export interface Monitor {
  groups: Group[];
  updated: string;
  sourceStatus?: string;
}
export function districtPublicationReminders(
  monitor: Monitor,
  profiles: {
    id: string;
    role: string;
    active?: boolean;
    pending?: boolean;
    districtId?: string | null;
  }[],
  now = Date.now(),
) {
  const age = now - Date.parse(monitor.updated);
  if (
    !Number.isFinite(age) ||
    age < -60000 ||
    age > 20 * 60000 ||
    monitor.sourceStatus === "stale"
  )
    return [];
  const districts = new Map<string, string[]>();
  for (const group of monitor.groups) {
    const did = String(group.okrug).trim();
    if (!/^(11[89]|12[0-9])$/.test(did)) continue;
    for (const key of ["vk", "tg"] as const) {
      const channel = group[key];
      if (channel?.status !== "ok" || !channel.last) continue;
      const last = Date.parse(channel.last),
        days = Math.floor((now - last) / 86400000);
      if (!Number.isFinite(last) || days < 2) continue;
      const label = `${group.city} · ${key === "vk" ? "ВК" : "Telegram"}: ${days} дн. без публикаций`;
      const list = districts.get(did) ?? [];
      if (!list.includes(label)) list.push(label);
      districts.set(did, list);
    }
  }
  const slot = Math.floor(now / (3 * 86400000));
  return profiles
    .filter(
      (p) =>
        p.role === "coordinator" &&
        p.active !== false &&
        !p.pending &&
        districts.has(p.districtId ?? ""),
    )
    .map((p) => ({
      userId: p.id,
      id: `group_silence_${slot}_${p.id}`,
      kind: "media",
      link: "#/media/groups",
      text: `Округ ${p.districtId}: пора проверить публикации.\n${districts.get(p.districtId!)!.slice(0, 12).join("\n")}\nЗагляните в «Что публикуем» — там материалы медиа-штаба.`,
    }));
}
