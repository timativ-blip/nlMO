// Демонстрационные данные. Все сроки строятся относительно текущей даты (МСК),
// поэтому демо остаётся «живым». Все показатели затем рассчитываются из этих записей.
import { addDays, todayISO, weekStart, stamp } from '../lib/date';
import { OKRUGS } from './okrugs';
import type { CalEvent, District, Metric, Priority, Report, State, Task, TaskStatus, User } from './types';

export const DATA_VERSION = 5;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DISTRICTS: District[] = OKRUGS.map((o) => ({ id: o.id, num: o.num, name: o.name, cities: o.cities, coordinatorName: o.coordinatorName, coordinatorId: null }));

const METRICS: Metric[] = [
  { id: 'm_meet', name: 'Встречи с жителями', unit: 'встреч', monthlyPlan: 2, weight: 1, description: 'Проведённые дворовые встречи и встречи в ЖК. Каждая подтверждённая задача-встреча даёт 1.' },
  { id: 'm_appeals', name: 'Обращения жителей', unit: 'обращений', monthlyPlan: 28, weight: 1, description: 'Принятые и зарегистрированные обращения граждан. Значение указывает исполнитель при сдаче результата.' },
  { id: 'm_supporters', name: 'Новые сторонники', unit: 'чел.', monthlyPlan: 16, weight: 1.5, description: 'Люди, оставившие контакты и согласие на связь. Значение указывает исполнитель.' },
  { id: 'm_events', name: 'Проведённые мероприятия', unit: 'мероприятий', monthlyPlan: 2, weight: 1, description: 'Публичные мероприятия округа: субботники, турниры, лекции.' },
];

const FIRST_M = ['Алексей', 'Дмитрий', 'Сергей', 'Михаил', 'Артём', 'Илья', 'Кирилл', 'Никита', 'Роман', 'Егор', 'Максим', 'Глеб', 'Степан', 'Тимофей'];
const FIRST_F = ['Анна', 'Мария', 'Екатерина', 'Ольга', 'Дарья', 'Алина', 'Полина', 'Виктория', 'Юлия', 'Софья', 'Вероника', 'Елена', 'Ксения', 'Таисия'];
const LAST = ['Соколов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов', 'Волков', 'Зайцев', 'Павлов', 'Семёнов', 'Голубев', 'Виноградов', 'Богданов', 'Воробьёв', 'Фёдоров', 'Михайлов', 'Беляев', 'Тарасов', 'Белов', 'Комаров', 'Орлов', 'Киселёв', 'Макаров', 'Андреев', 'Ковалёв', 'Ильин', 'Гусев', 'Титов', 'Кузьмин', 'Кудрявцев', 'Баранов', 'Куликов', 'Алексеев', 'Степанов', 'Яковлев', 'Сорокин', 'Сергеев'];

const PLACES = ['ЖК «Лесной квартал»', 'ул. Ленина, 14', 'парк «Берёзовая роща»', 'ТЦ «Галерея»', 'ЖК «Солнечный»', 'ДК «Юность»', 'школа № 3', 'набережная', 'ул. Советская, 8', 'сквер у станции'];

const TEMPLATES: { title: string; metric: string | null; desc: string; checklist?: string[] }[] = [
  { title: 'Дворовая встреча с жителями: {p}', metric: 'm_meet', desc: 'Собрать жителей, выслушать вопросы по благоустройству, зафиксировать обращения.', checklist: ['Согласовать место', 'Разместить объявление в чатах дома', 'Подготовить анкеты', 'Провести встречу'] },
  { title: 'Приём обращений: {p}', metric: 'm_appeals', desc: 'Организовать точку приёма обращений, зарегистрировать каждое обращение в форме.', checklist: ['Палатка и стол', 'Бланки обращений', 'Фотоотчёт'] },
  { title: 'Агитационный куб у {p}', metric: 'm_supporters', desc: 'Работа с жителями, сбор контактов сторонников с согласием на связь.', checklist: ['Получить материалы в штабе', 'Согласовать место', 'Собрать контакты'] },
  { title: 'Субботник: {p}', metric: 'm_events', desc: 'Общегородской субботник силами команды и жителей.', checklist: ['Инвентарь', 'Анонс в соцсетях', 'Фото до/после'] },
  { title: 'Турнир по мини-футболу для подростков', metric: 'm_events', desc: 'Спортивное мероприятие округа, партнёрство с местной школой.' },
  { title: 'Встреча с инициативной группой {p}', metric: 'm_meet', desc: 'Обсудить проблему с освещением и подготовить коллективное обращение.' },
  { title: 'Подготовить депутатский запрос по ремонту дороги', metric: null, desc: 'Собрать фото, адреса и подписи жителей, передать в штаб для запроса.' },
  { title: 'Пост в соцсетях округа о проделанной работе', metric: null, desc: 'Короткий текст и 3–5 фото, согласовать с медиа-направлением.' },
  { title: 'Обновить список волонтёров округа', metric: null, desc: 'Актуализировать контакты и готовность участвовать в мероприятиях.' },
  { title: 'Регистрация сторонников на {p}', metric: 'm_supporters', desc: 'Стойка регистрации, раздача информационных материалов.' },
  { title: 'Сбор подписей за установку детской площадки', metric: 'm_appeals', desc: 'Обход подъездов, сбор подписей и контактов жителей.' },
  { title: 'Фотофиксация проблемных участков {p}', metric: null, desc: 'Ямы, освещение, мусор — фото с геометкой для обращения в администрацию.' },
];

const MANAGERS = [
  { name: 'Ирина Власова', role: 'head' as const, position: 'Руководитель регионального отделения' },
  { name: 'Дмитрий Орлов', role: 'head' as const, position: 'Заместитель руководителя' },
  { name: 'Ксения Белова', role: 'staff' as const, position: 'Аналитик штаба' },
  { name: 'Павел Гришин', role: 'staff' as const, position: 'Медиа-направление' },
  { name: 'Вероника Тарасова', role: 'staff' as const, position: 'Организационный отдел' },
];

function translit(s: string) {
  const m: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ь: '', ъ: '' };
  return s.toLowerCase().split('').map((c) => m[c] ?? c).join('');
}

export function createSeed(): State {
  const r = rng(20261027);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const between = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const today = todayISO();
  const now = stamp();
  let idc = 0;
  const id = (p: string) => `${p}${(++idc).toString(36)}`;

  const users: User[] = [];
  const usedNames = new Set<string>();
  const mkUser = (name: string, role: User['role'], position: string, districtId: string | null): User => {
    const [first, last] = name.split(' ');
    const login = `${translit(first)[0]}.${translit(last)}`;
    const u: User = {
      id: id('u'), name, role, position, districtId,
      email: `${login}@nl-mo.example`,
      phone: `+7 (9${between(10, 99)}) ${between(100, 999)}-${between(10, 99)}-${between(10, 99)}`,
      telegram: `@${login.replace('.', '_')}`,
      birthday: undefined, birthdayVisibility: 'all', active: true,
    };
    // дни рождения: часть — в ближайшие недели, чтобы было видно в календаре
    const near = r() < 0.3;
    const md = near ? addDays(today, between(-5, 30)).slice(5) : `${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`;
    if (r() < 0.85) u.birthday = `${between(1972, 2004)}-${md}`;
    u.birthdayVisibility = r() < 0.15 ? 'hidden' : r() < 0.3 ? 'district' : 'all';
    users.push(u);
    usedNames.add(name);
    return u;
  };
  const fresh = (female: boolean) => {
    for (;;) {
      const last = pick(LAST);
      const name = `${pick(female ? FIRST_F : FIRST_M)} ${female ? (last.endsWith('ий') ? last.slice(0, -2) + 'ая' : last + 'а') : last}`;
      if (!usedNames.has(name)) return name;
    }
  };

  MANAGERS.forEach((m) => mkUser(m.name, m.role, m.position, null));
  const districts = DISTRICTS.map((d) => ({ ...d }));
  const DIRECTIONS = ['Работа с жителями', 'Волонтёры', 'Медиа', 'Мероприятия', 'Обращения'];
  districts.forEach((d) => {
    const coord = mkUser(fresh(r() < 0.5), 'coordinator', `Координатор округа ${d.name}`, d.id);
    d.coordinatorId = coord.id;
    const n = d.id === '128' ? 2 : between(3, 4);
    for (let i = 0; i < n; i++) mkUser(fresh(r() < 0.55), 'member', DIRECTIONS[(i + d.name.length) % DIRECTIONS.length], d.id);
  });
  // Гарантированная персона для демо-сценария
  const anna = users.find((u) => u.districtId === '121' && u.role === 'member')!;
  anna.name = 'Анна Соколова';
  anna.email = 'a.sokolova@nl-mo.example';
  anna.telegram = '@a_sokolova';
  anna.position = 'Работа с жителями';

  const head = users[0];
  const tasks: Task[] = [];
  const PERF = [0.88, 0.75, 0.82, 0.95, 0.7, 0.8, 0.85, 0.62, 0.72, 0.9, 0.55, 0.78];
  const perf: Record<string, number> = Object.fromEntries(districts.map((d, i) => [d.id, PERF[i % PERF.length]]));
  const curWeek = weekStart(today);
  const tsAt = (day: string, h = 12) => new Date(`${day}T${String(h - 3).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:00Z`).toISOString();

  districts.forEach((d) => {
    const team = users.filter((u) => u.districtId === d.id);
    const members = team.filter((u) => u.role === 'member');
    const coord = team.find((u) => u.role === 'coordinator')!;
    const p = perf[d.id];
    for (let w = -10; w <= 2; w++) {
      const nTasks = between(2, 4);
      for (let k = 0; k < nTasks; k++) {
        const tpl = pick(TEMPLATES);
        const due = addDays(addDays(curWeek, w * 7), between(0, 6));
        const assignee = r() < 0.85 ? pick(members) : coord;
        const author = r() < 0.65 ? coord : pick(users.filter((u) => u.role === 'head' || u.role === 'staff'));
        const created = addDays(due, -between(3, 10));
        const age = Math.floor((Date.parse(today) - Date.parse(due)) / 864e5);
        let status: TaskStatus;
        const x = r();
        const doneP = 0.72 + 0.22 * p;
        if (age > 3) status = x < doneP ? 'done' : x < doneP + 0.04 ? 'cancelled' : x < doneP + 0.06 ? 'review' : 'in_progress';
        else if (age >= 0) status = x < 0.45 * p ? 'done' : x < 0.62 ? 'review' : x < 0.9 ? 'in_progress' : 'new';
        else status = x < 0.45 ? 'new' : x < 0.88 ? 'in_progress' : 'review';
        const priority: Priority = (['normal', 'normal', 'normal', 'high', 'low', 'urgent', 'high'] as Priority[])[between(0, 6)];
        const place = pick(PLACES);
        const t: Task = {
          id: id('t'),
          title: tpl.title.replace('{p}', place),
          description: tpl.desc,
          assigneeId: assignee.id,
          coAssigneeIds: r() < 0.25 ? [pick(members.filter((m) => m.id !== assignee.id) as User[] || members)?.id].filter(Boolean) as string[] : [],
          districtId: d.id,
          authorId: author.id,
          due, priority, status,
          checklist: (tpl.checklist || []).map((text) => ({ id: id('c'), text, done: status === 'done' || status === 'review' || (status === 'in_progress' && r() < 0.5) })),
          comments: [], attachments: [],
          metricId: tpl.metric, eventId: null, result: null,
          createdAt: tsAt(created, 10),
          history: [{ at: tsAt(created, 10), userId: author.id, text: `Создал(а) задачу и назначил(а) ответственным: ${assignee.name}` }],
        };
        if (t.coAssigneeIds.includes(t.assigneeId)) t.coAssigneeIds = [];
        if (status !== 'new') t.history.push({ at: tsAt(addDays(created, 1), 11), userId: assignee.id, text: 'Взял(а) в работу' });
        if (status === 'review' || status === 'done') {
          const late = r() > p;
          const sub = late ? addDays(due, between(1, 3)) : addDays(due, -between(0, 2));
          const subDay = sub > today ? today : sub;
          const value = tpl.metric === 'm_appeals' ? Math.round(between(6, 22) * p) : tpl.metric === 'm_supporters' ? Math.round(between(4, 14) * p) : tpl.metric ? 1 : undefined;
          t.result = {
            text: pick(['Сделано, фотоотчёт приложен.', 'Мероприятие проведено, пришло больше людей, чем ожидали.', 'Выполнено. Обращения переданы в штаб.', 'Готово, подробности в приложенной ссылке.']),
            value,
            attachments: [{ id: id('a'), name: 'Фотоотчёт', kind: 'link', url: 'https://disk.example/report-' + t.id }],
            submittedAt: tsAt(subDay, 18), submittedDate: subDay,
          };
          t.history.push({ at: t.result.submittedAt, userId: assignee.id, text: 'Отправил(а) результат на проверку' });
          t.comments.push({ id: id('m'), authorId: assignee.id, text: t.result.text, at: t.result.submittedAt, kind: 'result' });
          if (status === 'done') {
            const conf = addDays(subDay, between(0, 2)) > today ? today : addDays(subDay, between(0, 2));
            t.confirmedAt = conf;
            t.confirmedBy = coord.id;
            t.history.push({ at: tsAt(conf, 20), userId: coord.id, text: 'Подтвердил(а) выполнение' });
          }
        }
        if (status === 'cancelled') t.history.push({ at: tsAt(due, 9), userId: author.id, text: 'Отменил(а) задачу: мероприятие перенесено организаторами' });
        tasks.push(t);
      }
    }
  });

  // Сценарий «возврат на доработку» и «ожидает проверки» для Анны
  const annaTasks = tasks.filter((t) => t.assigneeId === anna.id);
  const coordIstra = users.find((u) => u.id === districts[0].coordinatorId)!;
  const returned: Task = {
    ...annaTasks[0], id: id('t'), title: 'Фотоотчёт о встрече в ЖК «Лесной квартал»', status: 'in_progress', due: addDays(today, 1), priority: 'high',
    metricId: 'm_meet', returnedAt: tsAt(addDays(today, -1), 15), confirmedAt: null, confirmedBy: null,
    description: 'Подготовить фотоотчёт и короткое описание итогов встречи: сколько человек пришло, какие вопросы поднимали.',
    checklist: [{ id: id('c'), text: 'Отобрать 5–7 фото', done: true }, { id: id('c'), text: 'Список вопросов жителей', done: false }],
    result: null,
    comments: [
      { id: id('m'), authorId: anna.id, text: 'Встреча прошла, фото в папке.', at: tsAt(addDays(today, -2), 19), kind: 'result' },
      { id: id('m'), authorId: coordIstra.id, text: 'Анна, добавь, пожалуйста, список вопросов жителей и число участников — без этого не смогу принять в отчёт.', at: tsAt(addDays(today, -1), 15), kind: 'return' },
    ],
    history: [
      { at: tsAt(addDays(today, -6), 10), userId: coordIstra.id, text: 'Создал(а) задачу и назначил(а) ответственным: Анна Соколова' },
      { at: tsAt(addDays(today, -2), 19), userId: anna.id, text: 'Отправил(а) результат на проверку' },
      { at: tsAt(addDays(today, -1), 15), userId: coordIstra.id, text: 'Вернул(а) на доработку' },
    ],
    authorId: coordIstra.id, createdAt: tsAt(addDays(today, -6), 10), coAssigneeIds: [],
  };
  tasks.push(returned);

  // События
  const events: CalEvent[] = [];
  const evTitles: [string, CalEvent['type']][] = [['Субботник во дворах', 'event'], ['Встреча с жителями', 'meeting'], ['Праздник двора', 'event'], ['Открытая приёмная', 'meeting'], ['Школа волонтёра', 'training'], ['Лекция по финансовой грамотности', 'event']];
  for (let w = -4; w <= 4; w++) {
    const mon = addDays(curWeek, w * 7);
    events.push({
      id: id('e'), title: 'Планёрка штаба области', type: 'meeting', start: `${mon}T10:00`, end: `${mon}T11:00`, place: 'Онлайн', link: 'https://telemost.example/shtab',
      ownerId: head.id, participantIds: users.filter((u) => u.role !== 'member').map((u) => u.id), districtId: null,
      description: 'Еженедельная планёрка: итоги недели по округам, приоритеты на следующую неделю.', history: [],
    });
    districts.forEach((d, i) => {
      if ((w + i) % 2 !== 0) return;
      const [title, type] = evTitles[(i + w + 8) % evTitles.length];
      const day = addDays(mon, 5 - (i % 3));
      const h = between(11, 17);
      const team = users.filter((u) => u.districtId === d.id);
      events.push({
        id: id('e'), title: `${title} — ${d.name}`, type, start: `${day}T${h}:00`, end: `${day}T${h + 2}:00`,
        place: `${d.cities?.[0] ?? d.name}, ${pick(PLACES)}`, link: '', ownerId: d.coordinatorId!, participantIds: team.map((u) => u.id), districtId: d.id,
        description: 'Мероприятие округа. Ответственный — координатор, участники — команда округа.', history: [],
      });
    });
  }
  events.push({
    id: id('e'), title: 'Областной форум волонтёров «Новые люди Подмосковья»', type: 'event', start: `${addDays(today, 9)}T12:00`, end: `${addDays(today, 9)}T18:00`,
    place: 'Красногорск, Конгресс-центр', link: '', ownerId: users[4].id, participantIds: users.map((u) => u.id), districtId: null,
    description: 'Итоговое событие сезона: награждение лучших команд округов по рейтингу, обучающие секции, нетворкинг.', history: [],
  });
  // связать часть задач-мероприятий с событиями
  tasks.forEach((t) => {
    if (t.metricId !== 'm_events') return;
    const ev = events.find((e) => e.districtId === t.districtId && Math.abs(Date.parse(e.start.slice(0, 10)) - Date.parse(t.due)) < 4 * 864e5);
    if (ev) t.eventId = ev.id;
  });

  // Отчёты: прошедшие недели, плюс текущая — черновик
  const reports: Report[] = [];
  const TXT = {
    c: ['План по встречам выполнен, хороший отклик жителей ЖК.', 'Команда отработала стабильно, выросло число обращений.', 'Неделя ниже плана из-за погоды, мероприятия перенесены.'],
    p: ['Не хватает волонтёров на выходные.', 'Сложности с согласованием площадок у администрации.', 'Задержка с печатью материалов.'],
    n: ['Две дворовые встречи, приём обращений в субботу.', 'Субботник и регистрация сторонников у ТЦ.', 'Подготовка к областному форуму, обучение новичков.'],
  };
  districts.forEach((d, i) => {
    for (let w = -4; w <= 0; w++) {
      const ws = addDays(curWeek, w * 7);
      const status: Report['status'] = w <= -2 ? 'accepted' : w === -1 ? (['sent', 'accepted', 'returned', 'sent'] as const)[i % 4] : 'draft';
      const filled = w < 0;
      reports.push({
        id: `r_${d.id}_${ws}`, districtId: d.id, weekStart: ws, status,
        conclusions: filled ? TXT.c[(i + w + 9) % 3] : '', problems: filled ? TXT.p[(i + w + 9) % 3] : '', plan: filled ? TXT.n[(i + w + 9) % 3] : '',
        returnComment: status === 'returned' ? 'Добавьте, пожалуйста, причины переноса субботника и новую дату.' : undefined,
        updatedAt: filled ? tsAt(addDays(ws, 6), 18) : now,
        history: filled ? [{ at: tsAt(addDays(ws, 6), 18), userId: d.coordinatorId!, text: 'Отправил(а) отчёт' }] : [],
      });
    }
  });

  return {
    version: DATA_VERSION, seededAt: now, users, districts, tasks, events, reports, metrics: METRICS,
    notifications: [
      { id: id('n'), userId: anna.id, text: `${coordIstra.name} вернул(а) на доработку: «${returned.title}»`, at: tsAt(addDays(today, -1), 15), read: false, link: `#/tasks/${returned.id}`, kind: 'review' },
      { id: id('n'), userId: head.id, text: 'Областной форум волонтёров: изменено место проведения', at: tsAt(addDays(today, -1), 12), read: false, link: '#/calendar', kind: 'event' },
    ],
    audit: [],
    weights: {
      personCompletion: 40, personOnTime: 30, personVolume: 30,
      districtPlan: 50, districtCompletion: 25, districtOnTime: 25,
      priority: { low: 0.5, normal: 1, high: 1.5, urgent: 2 },
      lateFactor: 0.7, minTasks: 3,
    },
    ui: { period: 'month', districtId: 'all', taskView: 'list', notify: { assign: true, comment: true, review: true, event: true, report: true, deadline: true } },
    session: { userId: head.id },
  };
}
