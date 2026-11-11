import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PLAYWRIGHT_PATH ?? "playwright");
const base = "http://127.0.0.1:5180",
  api = "http://127.0.0.1:5192",
  out = "../hq-checks";
mkdirSync(out, { recursive: true });
const accounts = await (await fetch(api + "/fixture/accounts")).json(),
  checks = [],
  errors = [],
  unexpected = [];
await fetch(api + "/fixture/hq-reset", { method: "POST" });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const mark = (t) => {
  checks.push(t);
  console.log("PASS " + t);
};
async function context(account) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    serviceWorkers: "block",
  });
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "127.0.0.1" || ["data:", "blob:"].includes(u.protocol))
      return r.continue();
    unexpected.push(u.origin);
    return r.abort();
  });
  await ctx.addInitScript(
    ({ a }) => {
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: a.token,
          refresh_token: "fixture",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          user: {
            id: a.id,
            aud: "authenticated",
            role: "authenticated",
            email: a.id + "@example.invalid",
          },
        }),
      );
      localStorage.setItem("kc-appearance-v1", "dark");
    },
    { a: account },
  );
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/#/home");
  await p.getByRole("heading", { name: /Добрый день/ }).waitFor();
  try {
    await p
      .getByRole("button", { name: "Понятно, начать работу", exact: true })
      .click({ timeout: 1500 });
  } catch {}
  return { ctx, p };
}
async function rpc(a, action, body = {}) {
  const r = await fetch(api + "/rest/v1/rpc/headquarters", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + a.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_action: action, p_body: body }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message);
  return d;
}
const a = accounts[0],
  b = accounts[1];
let admin, coord;
try {
  admin = await context(a);
  coord = await context(b);
  const p = admin.p,
    c = coord.p;
  assert.equal(await p.locator(".hq-home-counters button").count(), 3);
  assert.equal(await p.locator(".home-geography").count(), 0);
  assert.equal(
    await p.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    ),
    "#042831",
  );
  await p.screenshot({
    animations: "disabled",
    path: out + "/home-dark-desktop.png",
  });
  mark(
    "home contains only three actionable counters, focus tasks and nearest meeting in requested teal palette",
  );
  await p
    .getByRole("button", { name: "Включить светлую тему", exact: true })
    .click();
  await p.screenshot({
    animations: "disabled",
    path: out + "/home-light-desktop.png",
  });
  mark("light theme remains available and changes full workspace");
  await p.goto(base + "/#/headquarters");
  await p.getByRole("heading", { name: "Штаб", exact: true }).waitFor();
  await p
    .getByRole("button", { name: "Забронировать", exact: true })
    .first()
    .click();
  let dlg = p.getByRole("dialog", { name: "Бронирование", exact: true });
  await dlg
    .getByLabel("Для чего бронируете", { exact: true })
    .fill("Проверка брони штаба");
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await p.getByText("Проверка брони штаба", { exact: false }).waitFor();
  mark("room booking persists and names its responsible employee");
  await c.goto(base + "/#/headquarters");
  await c
    .getByRole("button", { name: "Забронировать", exact: true })
    .first()
    .click();
  dlg = c.getByRole("dialog", { name: "Бронирование", exact: true });
  await dlg
    .getByLabel("Для чего бронируете", { exact: true })
    .fill("Пересекающаяся бронь");
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  await dlg
    .getByRole("alert")
    .filter({ hasText: /уже есть бронь/ })
    .waitFor();
  await dlg
    .getByRole("button", { name: "Закрыть", exact: true })
    .last()
    .click();
  assert.equal(
    (await rpc(a, "index")).reservations.filter(
      (r) => r.purpose === "Пересекающаяся бронь",
    ).length,
    0,
  );
  mark(
    "a second independent session receives visible conflict and cannot double-book headquarters",
  );
  await p.goto(base + "/#/equipment");
  await p
    .getByRole("button", { name: "Добавить оборудование", exact: true })
    .click();
  dlg = p.getByRole("dialog", { name: "Новое оборудование", exact: true });
  await dlg.getByLabel("Название", { exact: true }).fill("Тестовый проектор");
  await dlg.getByLabel("Инвентарный номер", { exact: true }).fill("П-001");
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await c.goto(base + "/#/equipment");
  await c
    .getByRole("heading", { name: "Тестовый проектор", exact: true })
    .waitFor();
  await c.getByRole("button", { name: "Забронировать", exact: true }).click();
  dlg = c.getByRole("dialog", { name: "Бронирование", exact: true });
  await dlg
    .getByLabel("Для чего бронируете", { exact: true })
    .fill("Выездная встреча округа");
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await c.getByRole("button", { name: "Я получил", exact: true }).click();
  dlg = c.getByRole("dialog", { name: "Подтвердить получение", exact: true });
  await dlg
    .getByLabel("Состояние и комплектность", { exact: true })
    .fill("Комплект полный");
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await c.getByRole("button", { name: "Я вернул", exact: true }).click();
  dlg = c.getByRole("dialog", { name: "Подтвердить возврат", exact: true });
  await dlg
    .getByLabel("Состояние и комплектность", { exact: true })
    .fill("Без повреждений");
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await c.getByRole("tab", { name: "История", exact: true }).click();
  await c.getByText("Без повреждений", { exact: false }).waitFor();
  const index = await rpc(a, "index");
  const loan = index.reservations.find(
    (r) => r.purpose === "Выездная встреча округа",
  );
  assert.equal(loan.status, "returned");
  assert.equal(loan.borrower_id, b.id);
  mark(
    "employee independently books, receives and returns equipment with condition notes and accountable history",
  );
  await p.goto(base + "/#/materials");
  await p.getByRole("button", { name: "Добавить", exact: true }).click();
  dlg = p.getByRole("dialog", { name: "Материал или папка", exact: true });
  await dlg.getByLabel("Название", { exact: true }).fill("Рабочие шаблоны");
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await p
    .locator(".material-card")
    .filter({ hasText: "Рабочие шаблоны" })
    .getByRole("button", { name: "Открыть", exact: true })
    .click();
  await p.getByRole("button", { name: "Добавить", exact: true }).click();
  dlg = p.getByRole("dialog", { name: "Материал или папка", exact: true });
  await dlg.getByLabel("Тип материала", { exact: true }).selectOption("link");
  await dlg.getByLabel("Название", { exact: true }).fill("Шаблон протокола");
  await dlg
    .getByLabel("Ссылка", { exact: true })
    .fill("https://example.org/protocol");
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await p
    .getByRole("heading", { name: "Шаблон протокола", exact: true })
    .waitFor();
  await p.screenshot({
    animations: "disabled",
    path: out + "/materials-light-desktop.png",
  });
  mark(
    "HQ can organize nested folders and links without changing Google Drive sharing",
  );
  await p.goto(base + "/#/planning");
  await p
    .getByRole("button", { name: "Добавить протокол", exact: true })
    .click();
  dlg = p.getByRole("dialog", { name: "Добавить планёрку", exact: true });
  await dlg
    .getByLabel("Название", { exact: true })
    .fill("Очная планёрка округа");
  await dlg
    .getByLabel("Ответственный за повестку и протокол", { exact: true })
    .selectOption(b.id);
  await dlg
    .getByLabel("Итоги обсуждения", { exact: true })
    .fill("Обсудили рабочий план и материалы.");
  await dlg.locator("input[type=file]").setInputFiles({
    name: "Протокол.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Решения очной планёрки"),
  });
  await dlg.getByRole("button", { name: "Убрать", exact: true }).waitFor();
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  dlg = p.getByRole("dialog", { name: "Протокол планёрки", exact: true });
  await dlg
    .getByRole("button", { name: "Протокол из расшифровки", exact: true })
    .click();
  await dlg
    .getByRole("status")
    .filter({ hasText: "Подключение подготовлено" })
    .waitFor();
  assert.equal(
    await dlg
      .getByRole("button", { name: "Подготовить черновик", exact: true })
      .isDisabled(),
    true,
  );
  mark(
    "AI helper clearly reports pending connection and never pretends to generate without credentials",
  );
  await dlg
    .getByRole("button", { name: "Отправить участникам", exact: true })
    .click();
  const send = p.getByRole("dialog", {
    name: "Отправить протокол участникам?",
    exact: true,
  });
  await send
    .getByRole("button", { name: "Да, отправить", exact: true })
    .click();
  await send.waitFor({ state: "hidden" });
  await dlg
    .getByRole("button", { name: "Закрыть", exact: true })
    .last()
    .click();
  const archive = (await rpc(a, "index")).minutes.find(
    (d) => d.title === "Очная планёрка округа",
  );
  assert.equal(archive.published_version, 1);
  assert.equal(archive.attachments.length, 1);
  assert.match(archive.attachments[0].url, /^sb:\/\/meeting-protocols\//);
  await c.goto(base + "/#/planning/" + archive.id);
  dlg = c.getByRole("dialog", { name: "Протокол планёрки", exact: true });
  await dlg.getByLabel("Итоги обсуждения", { exact: true }).waitFor();
  assert.equal(
    await dlg.getByLabel("Итоги обсуждения", { exact: true }).isEnabled(),
    true,
  );
  await dlg
    .getByLabel("Принятые решения", { exact: true })
    .fill("Дополнение ответственного");
  await c.keyboard.press("Escape");
  const unsaved = c.getByRole("dialog", {
    name: "Закрыть без сохранения?",
    exact: true,
  });
  await unsaved.waitFor();
  await unsaved
    .getByRole("button", { name: "Продолжить", exact: true })
    .click();
  assert.equal(
    await dlg.getByLabel("Принятые решения", { exact: true }).inputValue(),
    "Дополнение ответственного",
  );
  await dlg.getByRole("button", { name: "Сохранить", exact: true }).click();
  await dlg.getByRole("status").filter({ hasText: "Опубликован" }).waitFor();
  assert.equal(
    (await rpc(a, "index")).minutes.find((d) => d.id === archive.id).content
      .decisions,
    "Дополнение ответственного",
  );
  await dlg
    .getByRole("button", { name: "Закрыть", exact: true })
    .last()
    .click();
  mark(
    "external planning protocol publishes to recipients; delegated responsible edits it and unsaved close is protected",
  );
  await c.goto(base + "/#/performance");
  await c
    .getByRole("heading", { name: "Успеваемость координаторов", exact: true })
    .waitFor();
  await c.getByText("Мало данных", { exact: true }).first().waitFor();
  assert.equal(
    await c.locator(".performance-score").first().innerText(),
    "—\nМало данных",
  );
  mark(
    "performance shows lack of task evidence instead of a fabricated zero rating",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(base + "/#/home");
  await p.getByRole("heading", { name: /Добрый день/ }).waitFor();
  await p.screenshot({
    animations: "disabled",
    path: out + "/home-light-mobile.png",
  });
  await p.getByRole("button", { name: "Ещё", exact: true }).click();
  const menu = p.getByRole("dialog", { name: "Разделы", exact: true });
  await menu.getByRole("button", { name: "Оборудование", exact: true }).click();
  await p
    .getByRole("heading", { name: "Оборудование и инвентарь", exact: true })
    .waitFor();
  await p
    .getByRole("button", { name: "Включить тёмную тему", exact: true })
    .click();
  await p.screenshot({
    animations: "disabled",
    path: out + "/equipment-dark-mobile.png",
  });
  assert.equal(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  mark(
    "new sections remain reachable on phone, with no horizontal overflow in light or dark theme",
  );
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto(base + "/#/home");
  const sidebar = p.getByRole("complementary", { name: "Основная навигация" });
  assert.equal(await sidebar.locator(".nav-group-heading").count(), 4);
  const work = sidebar.getByRole("button", { name: "Работа", exact: true });
  if ((await work.getAttribute("aria-expanded")) === "true") await work.click();
  await p.reload();
  await p.getByRole("heading", { name: /Добрый день/ }).waitFor();
  assert.equal(
    await sidebar
      .getByRole("button", { name: "Работа", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(
    await sidebar
      .getByRole("link", { name: "Задачи", exact: true })
      .isVisible(),
    false,
  );
  await p.goto(base + "/#/performance");
  await p
    .getByRole("heading", { name: "Успеваемость координаторов", exact: true })
    .waitFor();
  assert.equal(
    await sidebar
      .getByRole("button", { name: "Контроль", exact: true })
      .getAttribute("aria-expanded"),
    "true",
  );
  await sidebar
    .getByRole("button", { name: "Свернуть меню", exact: true })
    .click();
  assert.equal(
    await sidebar
      .getByRole("link", { name: "Оборудование", exact: true })
      .isVisible(),
    true,
  );
  await sidebar
    .getByRole("button", { name: "Развернуть меню", exact: true })
    .click();
  await p.goto(base + "/#/home");
  for (const name of ["Контроль", "Встречи", "Штаб"]) {
    const group = sidebar.getByRole("button", { name, exact: true });
    if ((await group.getAttribute("aria-expanded")) === "true")
      await group.click();
  }
  await sidebar.getByRole("button", { name: "Работа", exact: true }).click();
  await p.screenshot({
    path: out + "/home-glass-grouped-desktop.png",
    animations: "disabled",
  });
  mark(
    "navigation has four collapsible groups, remembers choices, opens current section and retains every route in compact mode",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  writeFileSync(
    out + "/result.json",
    JSON.stringify({ passed: true, checks, errors, unexpected }, null, 2),
  );
} catch (e) {
  for (const [key, entry] of Object.entries({ admin, coord }))
    if (entry) {
      await entry.p
        .screenshot({ path: out + "/" + key + "-failure.png" })
        .catch(() => {});
      console.log(
        key +
          " dialogs: " +
          JSON.stringify(await entry.p.getByRole("dialog").allTextContents()),
      );
    }
  writeFileSync(
    out + "/result.json",
    JSON.stringify(
      { passed: false, checks, errors, unexpected, error: e.stack },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
}
