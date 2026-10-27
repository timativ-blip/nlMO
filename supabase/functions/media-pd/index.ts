// @ts-nocheck — логика перенесена без изменений из исходного JS
// Перенесено из media-podmoskovya (Vercel) в Supabase Edge Functions.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body: unknown, status = 200, maxAge = 60) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` } });
// Пиши-Делись · Московская область
// Посты — из Google-таблицы, список людей по округам — из Google-документа.
const SHEET_URL = "https://docs.google.com/spreadsheets/d/18UL3TQHRS-3A8xkQ1zLwwLcPKCgnGJOQ/export?format=csv";
// вкладка «Невыполнены условия» той же таблицы
const UNMET_URL = "https://docs.google.com/spreadsheets/d/18UL3TQHRS-3A8xkQ1zLwwLcPKCgnGJOQ/export?format=csv&gid=863510144";
const DOC_URL = "https://docs.google.com/document/d/1735-efKI9OAQcd5raz3Nu96cNTI_pS3XhfjNGqNP_wM/export?format=txt";

const OKRUG_NAMES = {
  118: "Балашихинский", 119: "Дмитровский", 120: "Коломенский", 121: "Красногорский",
  122: "Люберецкий", 123: "Мытищинский", 124: "Одинцовский", 125: "Орехово-Зуевский",
  126: "Подольский", 127: "Сергиево-Посадский", 128: "Серпуховский", 129: "Щёлковский"
};
const SOURCES = ["vk", "tg", "youtube", "tiktok", "instagram"];

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = s => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const num = s => { const x = parseFloat(String(s || "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(x) ? x : 0; };

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// документ: «118 округ …», «Штаб», строки «🟢 Фамилия Имя — N»
function parseRoster(text) {
  const groups = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/﻿/g, "").trim();
    if (!line) continue;
    const m = line.match(/^(\d{3})\s*округ/i);
    if (m) {
      const n = +m[1];
      cur = { id: String(n), num: n, name: OKRUG_NAMES[n] || "", people: [] };
      groups.push(cur); continue;
    }
    if (/^штаб(\s|$)/i.test(line)) { cur = { id: "hq", num: 0, name: "Штаб", people: [] }; groups.push(cur); continue; }
    if (!cur || /^итого/i.test(line)) continue;
    const p = line.replace(/^[^А-ЯЁа-яёA-Za-z]+/, "").match(/^(.+?)\s*[—–-]\s*\d+\s*$/);
    if (p) cur.people.push(p[1].trim());
  }
  return groups;
}

async function build(): Promise<unknown> {
  try {
    const [sr, dr, ur] = await Promise.all([
      fetch(SHEET_URL, { redirect: "follow" }), fetch(DOC_URL, { redirect: "follow" }),
      fetch(UNMET_URL, { redirect: "follow" }).catch(() => null)
    ]);
    if (!sr.ok) throw new Error("sheet " + sr.status);
    if (!dr.ok) throw new Error("doc " + dr.status);
    const [head, ...rows] = parseCsv(await sr.text());
    const groups = parseRoster(await dr.text());
    // вкладка с невыполненными условиями необязательна: если её нет, просто пропускаем
    let unmetRows = [], uhead = [];
    if (ur && ur.ok) { [uhead = [], ...unmetRows] = parseCsv(await ur.text()); }
    const columns = h => { const col = n => h.indexOf(n); return {
      date: col("Дата поста"), title: col("Заголовок"), channel: col("Канал/группа"), src: col("Источник"),
      fio: col("ФИО"), pts: col("Очки"), contrib: col("Вклад в регион"), views: col("Просмотры"),
      likes: col("Лайки"), comments: col("Комментарии"), reposts: col("Репосты"), favs: col("В избранное"), url: col("URL"),
      crit: col("Критерии"), unmet: col("Невыполненные критерии"), acc: col("ID аккаунта")
    }; };
    const C = columns(head), U = columns(uhead);
    if ([C.date, C.src, C.fio, C.pts].some(i => i < 0)) throw new Error("columns not found");

    // люди из документа: ключ «фамилия|первая буква имени»
    const people = [], byKey = new Map();
    for (const g of groups) for (const full of g.people) {
      const w = norm(full).split(" ");
      const idx = people.push({ name: full, group: g.id }) - 1;
      const k1 = w[0] + "|" + (w[1] || "")[0];
      if (!byKey.has(k1)) byKey.set(k1, idx);
    }
    // запасной ключ «имя фамилия» (если в документе порядок перепутан)
    people.forEach((p, i) => {
      const w = norm(p.name).split(" ");
      if (w[1]) { const k2 = w[1] + "|" + w[0][0]; if (!byKey.has(k2)) byKey.set(k2, i); }
    });

    // если в профиле нет фамилии (ФИО «- М.»), ищем человека по названию канала: «Михаил К» → «Калинин Михаил»
    const rosterN = people.length;
    function byChannel(channel, ini) {
      const toks = norm(channel).split(/[^а-яa-z]+/).filter(Boolean);
      const hit = new Set();
      for (let i = 0; i < rosterN; i++) {
        const pw = norm(people[i].name).split(" ");
        for (const [sur, first] of [[pw[0], pw[1]], [pw[1], pw[0]]]) {
          if (!sur || !first || (ini && first[0] !== ini) || !toks.includes(first)) continue;
          if (toks.includes(sur) || toks.some(t => t.length <= 2 && sur.startsWith(t))) hit.add(i);
        }
      }
      return hit.size === 1 ? [...hit][0] : undefined;
    }

    const matchCache = new Map();
    function authorOf(fio, channel, acc) {
      const w = norm(fio).replace(/\./g, "").split(" ");
      const sur = w[0] || "", ini = (w[1] || "")[0] || "";
      if (!/[а-яa-z]/.test(sur)) {
        const key = "?" + acc + "|" + channel;
        if (matchCache.has(key)) return matchCache.get(key);
        let idx = byChannel(channel, ini);
        if (idx === undefined) idx = people.push({ name: channel.trim() || fio.trim() || "Без имени", group: "none" }) - 1;
        matchCache.set(key, idx);
        return idx;
      }
      if (matchCache.has(fio)) return matchCache.get(fio);
      let idx = byKey.get(sur + "|" + ini);
      if (idx === undefined && sur.length >= 4 && /[а-я]/.test(sur)) {
        // опечатки в фамилии: одна-две буквы, та же первая буква имени, единственный кандидат
        const cands = [...byKey.entries()].filter(([k]) => {
          const [s, i] = k.split("|");
          return i === ini && Math.abs(s.length - sur.length) <= 2 && lev(s, sur) <= (sur.length >= 7 ? 2 : 1);
        }).map(([, v]) => v);
        const uniq = [...new Set(cands)];
        if (uniq.length === 1) idx = uniq[0];
      }
      if (idx === undefined) idx = people.push({ name: fio.trim() || "Без имени", group: "none" }) - 1;
      matchCache.set(fio, idx);
      return idx;
    }

    const posts = [], seen = new Set();
    // forceUnmet — строки со вкладки «Невыполнены условия»; дубли по ссылке берём один раз
    function addRows(rows, C, forceUnmet) {
    if ([C.date, C.src, C.fio, C.pts].some(i => i < 0)) return;
    for (const r of rows) {
      const src = (r[C.src] || "").trim().toLowerCase();
      const date = (r[C.date] || "").trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const url = (r[C.url] || "").trim();
      if (url) { if (seen.has(url)) continue; seen.add(url); }
      posts.push([
        date,
        (r[C.title] || "").trim().slice(0, 160),
        (r[C.channel] || "").trim().slice(0, 80),
        SOURCES.includes(src) ? src : "other",
        authorOf(r[C.fio] || "", (r[C.channel] || "").trim(), C.acc < 0 ? "" : (r[C.acc] || "").trim()),
        Math.round(num(r[C.pts]) * 100) / 100,
        Math.round(num(r[C.contrib]) * 100) / 100,
        num(r[C.views]), num(r[C.likes]), num(r[C.comments]), num(r[C.reposts]), num(r[C.favs]),
        /^https?:\/\//i.test(url) ? url : "",
        // 1 — пост засчитан («Выполнены»), 0 — критерии не выполнены
        !forceUnmet && (C.crit < 0 || /^выполнен/i.test((r[C.crit] || "").trim())) ? 1 : 0,
        C.unmet < 0 ? "" : (r[C.unmet] || "").trim().slice(0, 160)
      ]);
    }
    }
    addRows(rows, C, false);
    addRows(unmetRows, U, true);
    return ({
      groups: groups.map(g => ({ id: g.id, num: g.num, name: g.name })),
      people: people.map(p => [p.name, p.group]),
      posts,
      updated: new Date().toISOString()
    });
  } catch (e) {
    throw e;
  }
}

let cache: { at: number; data: unknown } | null = null;
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!cache || Date.now() - cache.at > 60 * 1000) cache = { at: Date.now(), data: await build() };
    return json(cache.data, 200, 60);
  } catch (_e) {
    if (cache) return json(cache.data, 200, 30);
    return json({ error: 'source unavailable' }, 502, 0);
  }
});
