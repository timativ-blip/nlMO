import { SEASON_11, type PdData } from "../_shared/media-timeline.ts";

type Profile = { id: string; name?: string; districtId?: string; role?: string; active?: boolean; pending?: boolean };
const dayMs = 86400000;
const nameKey = (name: string) => name.toLowerCase().replace(/ё/g, "е")
  .replace(/[^a-zа-я\s-]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).sort().join(" ");

export function pdReminderCandidates(pd: PdData | null, profiles: Profile[], today: string, now = Date.now()) {
  const freshAt = Date.parse(pd?.updated ?? "");
  if (!pd || pd.sourceStatus !== "ok" || !Number.isFinite(freshAt) || freshAt > now + 60000 || now - freshAt > dayMs) {
    return { skipped: "Не удалось проверить актуальность «Пиши-Делись».", items: [] };
  }
  if (today < SEASON_11.from || today > SEASON_11.to) {
    return { skipped: "Сезон «Пиши-Делись» сейчас не идёт.", items: [] };
  }
  const last = new Map<number, string>();
  for (const post of pd.posts) {
    const [day, , , , author] = post;
    if (day < SEASON_11.from || day > today) continue;
    if ((last.get(author) ?? "") < day) last.set(author, day);
  }
  // Authors of this season can receive reminders even when nobody has posted recently.
  const authors = new Set([...(pd.roster?.members ?? []), ...last.keys()]);
  const names = new Map<string, number[]>();
  for (const index of authors) {
    const person = pd.people[index];
    if (!person) continue;
    const key = nameKey(person[0]);
    if (!key) continue;
    const matches = names.get(key) ?? [];
    matches.push(index);
    names.set(key, matches);
  }
  const slot = Math.floor(Date.parse(today) / (3 * dayMs));
  const items = profiles.flatMap((profile) => {
    if (profile.active === false || profile.pending || !["head", "staff", "coordinator"].includes(profile.role ?? "")) return [];
    const matches = names.get(nameKey(profile.name ?? "")) ?? [];
    const inDistrict = matches.filter((index) => pd.people[index]?.[1] === profile.districtId);
    const candidates = inDistrict.length ? inDistrict : matches;
    if (candidates.length !== 1) return [];
    const latest = last.get(candidates[0]);
    const days = Math.round((Date.parse(today) - Date.parse(latest ?? SEASON_11.from)) / dayMs);
    if (days < 3) return [];
    const texts = latest ? [
      "Пора подготовить публикацию для «Пиши-Делись». Последний пост в таблице от " + latest.slice(8) + "." + latest.slice(5, 7) + ".",
      "Запланируйте следующий пост для «Пиши-Делись». Идеи и шаблоны есть в разделе «Что публикуем».",
      "В «Пиши-Делись» несколько дней нет новых постов от вас. Если уже опубликовали, проверьте, внесена ли ссылка в таблицу.",
    ] : [
      "Добавьте первую публикацию этого сезона в «Пиши-Делись».",
      "Проверьте, появилась ли в таблице ссылка на вашу публикацию «Пиши-Делись».",
      "Выберите тему для «Пиши-Делись». Подсказки есть в разделе «Что публикуем».",
    ];
    return [{
      userId: profile.id,
      id: "pd_" + slot + "_" + profile.id.slice(0, 8),
      link: "#/media/brief", kind: "media", text: texts[slot % texts.length],
    }];
  });
  return { items };
}
