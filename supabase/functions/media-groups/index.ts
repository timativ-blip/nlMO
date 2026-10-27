// @ts-nocheck — логика перенесена без изменений из исходного JS
// Перенесено из media-podmoskovya (Vercel) в Supabase Edge Functions.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body: unknown, status = 200, maxAge = 60) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` } });
// Партийные группы округов: когда был последний пост в ВК и Telegram.
// Список групп — из Google-таблицы; Telegram читаем через публичную ленту t.me/s/…,
// ВКонтакте — через API (нужен сервисный ключ в переменной окружения VK_TOKEN).
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1BaB7mUx71IrIMWo_MCEcPa2qncPRAxpd0xRsEociUGA/export?format=csv&gid=1636773863";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

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
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function get(url, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" }, redirect: "follow", signal: ac.signal }); }
  finally { clearTimeout(t); }
}

const vkRef = s => { const m = String(s || "").match(/vk\.(?:com|ru)\/([A-Za-z0-9_.]+)/i); return m ? m[1] : ""; };
const tgRef = s => { const m = String(s || "").match(/t\.me\/(?:s\/)?([A-Za-z0-9_]{4,})/i); return m ? m[1] : ""; };

// коротко «о чём пост»: начало текста без ссылок, хештегов и эмодзи, 1–2 предложения
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…" };
const unhtml = h => String(h || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ""), /^#x/i.test(e) ? 16 : 10)) : (ENT[e.toLowerCase()] ?? m));
function brief(t) {
  t = String(t || "")
    .replace(/https?:\/\/\S+/g, " ").replace(/\[(?:club|id|public)\d+\|([^\]]*)\]/g, "$1")
    .replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/\s+/g, " ").trim();
  if (!t) return "";
  const parts = t.match(/[^.!?…]+[.!?…]*/g) || [t];
  let out = parts[0].trim();
  if (out.length < 60 && parts[1]) out += " " + parts[1].trim();
  return out.length > 170 ? out.slice(0, 167).replace(/\s+\S*$/, "") + "…" : out;
}

// Telegram: публичная лента канала, берём самый свежий пост
async function tgLast(name) {
  try {
    const r = await get("https://t.me/s/" + name);
    if (!r.ok) return { status: "error" };
    // закрытый канал или личный аккаунт: t.me/s/… перекидывает на t.me/…
    if (!/\/s\//.test(r.url)) return { status: "closed" };
    const html = await r.text();
    // каждое сообщение: data-post, текст и время
    // служебные сообщения («канал создан», «закреплено фото») не считаем
    const msgs = html.split(/(?=<div class="tgme_widget_message_wrap)/).slice(1).filter(b => !/class="tgme_widget_message [^"]*service_message/.test(b)).map(b => {
      const post = (b.match(/data-post="([^"]+)"/) || [])[1];
      const time = (b.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
      const text = (b.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
      return post && time ? { post, t: Date.parse(time), text: unhtml(text) } : null;
    }).filter(Boolean);
    if (!msgs.length) return { status: /tgme_page_title|tgme_channel_info/.test(html) ? "empty" : "error" };
    const best = msgs.reduce((a, b) => (b.t > a.t ? b : a));
    return { status: "ok", last: new Date(best.t).toISOString(), url: "https://t.me/" + best.post, about: brief(best.text) || "пост без текста (фото или видео)" };
  } catch (e) { return { status: "error" }; }
}

// ВКонтакте: execute по 25 вызовов wall.get, закреплённый пост не считаем
async function vkLast(refs, token) {
  const out = {};
  const arg = ref => {
    const m = ref.match(/^(?:club|public)(\d+)$/i);
    return m ? `"owner_id":-${m[1]}` : `"domain":"${ref.replace(/[^A-Za-z0-9_.]/g, "")}"`;
  };
  for (let i = 0; i < refs.length; i += 25) {
    const part = refs.slice(i, i + 25);
    const code = "return [" + part.map(ref => `API.wall.get({${arg(ref)},"count":3})`).join(",") + "];";
    try {
      const r = await get("https://api.vk.com/method/execute?v=5.199&access_token=" + encodeURIComponent(token) + "&code=" + encodeURIComponent(code), 9000);
      const j = await r.json();
      const res = j.response || [];
      part.forEach((ref, k) => {
        const w = res[k];
        if (!w || !w.items) { out[ref] = { status: "error" }; return; }
        const items = w.items.filter(x => !x.is_pinned);
        if (!items.length) { out[ref] = { status: "empty" }; return; }
        const p = items.reduce((a, b) => (b.date > a.date ? b : a));
        const txt = p.text || (p.copy_history && p.copy_history[0] && p.copy_history[0].text) || "";
        out[ref] = { status: "ok", last: new Date(p.date * 1000).toISOString(), url: `https://vk.com/wall${p.owner_id}_${p.id}`,
          about: (p.copy_history ? "Репост: " : "") + (brief(txt) || "пост без текста (фото или видео)") };
      });
    } catch (e) { part.forEach(ref => { out[ref] = { status: "error" }; }); }
  }
  return out;
}

async function build(): Promise<unknown> {
  try {
    const r = await get(SHEET_URL);
    if (!r.ok) throw new Error("sheet " + r.status);
    const [head, ...rows] = parseCsv(await r.text());
    const col = n => head.findIndex(h => h.trim().toLowerCase().startsWith(n));
    const C = { okr: col("№округа"), city: col("город"), vk: col("ссылка на партийную группу вк"), tg: col("ссылка на партийную группу тг"), coord: col("координатор"), resp: col("ответственный") };
    if (C.city < 0 || C.vk < 0) throw new Error("columns not found");

    let okr = "";
    const groups = [];
    for (const row of rows) {
      const cell = i => (i < 0 ? "" : (row[i] || "").trim());
      if (cell(C.okr)) okr = cell(C.okr);
      const city = cell(C.city);
      if (!city) continue;
      groups.push({
        okrug: okr, city, coord: cell(C.coord), resp: cell(C.resp),
        vkRef: vkRef(cell(C.vk)), tgRef: tgRef(cell(C.tg)),
        vkUrl: /^https?:\/\//i.test(cell(C.vk)) ? cell(C.vk) : "", tgUrl: /^https?:\/\//i.test(cell(C.tg)) ? cell(C.tg) : ""
      });
    }

    const token = Deno.env.get("VK_TOKEN") || "";
    const tgNames = [...new Set(groups.map(g => g.tgRef).filter(Boolean))];
    const vkNames = [...new Set(groups.map(g => g.vkRef).filter(Boolean))];
    const [tgRes, vkRes] = await Promise.all([
      Promise.all(tgNames.map(n => tgLast(n).then(x => [n, x]))).then(Object.fromEntries),
      token ? vkLast(vkNames, token) : Promise.resolve({})
    ]);

    const out = groups.map(g => ({
      okrug: g.okrug, city: g.city, coord: g.coord, resp: g.resp,
      vk: g.vkRef ? Object.assign({ link: g.vkUrl }, token ? (vkRes[g.vkRef] || { status: "error" }) : { status: "nokey" }) : null,
      tg: g.tgRef ? Object.assign({ link: g.tgUrl }, tgRes[g.tgRef] || { status: "error" }) : null
    }));
    return ({ groups: out, vkEnabled: !!token, updated: new Date().toISOString() });
  } catch (e) {
    throw e;
  }
}

let cache: { at: number; data: unknown } | null = null;
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!cache || Date.now() - cache.at > 900 * 1000) cache = { at: Date.now(), data: await build() };
    return json(cache.data, 200, 900);
  } catch (_e) {
    if (cache) return json(cache.data, 200, 30);
    return json({ error: 'source unavailable' }, 502, 0);
  }
});
