import { splitText } from './protocol.ts';

export interface BotAttachment {
  id: string;
  name: string;
  kind: 'photo' | 'file' | 'link';
  url: string;
  size?: number;
}
export interface BotPerson {
  id: string;
  name: string;
  role: 'head' | 'coordinator' | 'staff' | 'member';
  districtId: string | null;
}
export interface BotTask {
  id: string;
  title: string;
  due: string;
  metricId: string | null;
  metricName: string | null;
  unit: string | null;
  revision: string;
}
export interface BotReport {
  id: string;
  districtId: string;
  districtName: string;
  weekStart: string;
  conclusions: string;
  plan: string;
  problems: string;
  revision: string | null;
}
export interface BotDaily {
  id: string;
  day: string;
  done: string;
  plan: string;
  problems: string;
  revision: string;
}
export type Kind = 'daily' | 'result' | 'weekly';
export type Stage = 'choose' | 'done' | 'plan' | 'problems' | 'text' | 'value' | 'attachments' | 'conclusions' | 'confirm';
export interface BotDraft {
  metric?: string | null;
  id: string;
  nonce: string;
  kind: Kind;
  stage: Stage;
  page: number;
  target: string;
  base: string | null;
  fields: { done: string; plan: string; problems: string; text: string; value: string; conclusions: string };
  attachments: BotAttachment[];
  replace?: boolean;
}
export interface BotContext {
  userId: string | null;
  me: BotPerson | null;
  revision: number;
  draft: BotDraft | null;
  tasks: BotTask[];
  reports: BotReport[];
  daily: BotDaily[];
}
export interface BotButton {
  text: string;
  callback_data?: string;
  app?: string;
}
export interface BotMessage {
  text: string;
  buttons?: BotButton[][];
}
export interface BotPlan {
  draft: BotDraft | null;
  reply: BotMessage[];
  operation?: { kind: 'submit' | 'link' | 'unlink'; nonce?: string; code?: string };
}
export interface BotInput {
  text?: string;
  callback?: string;
  attachment?: BotAttachment;
}
const nonce = () => crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const day = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const shift = (date: string, offset: number) =>
  new Date(Date.parse(date + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const fmt = (date: string) => date.split('-').reverse().join('.');
const button = (text: string, callback_data: string): BotButton => ({ text, callback_data });
const menus = (me: BotPerson | null): BotButton[][] => [
  [{ text: 'Открыть сайт', app: '' }],
  ...(me
    ? [
        [button('Мои задачи', 'tasks')],
        ...(me.role !== 'member' ? [[button('Отчёт дня', 'daily')]] : []),
        ...(me.role === 'head' || me.role === 'coordinator' ? [[button('Недельный отчёт', 'weekly')]] : []),
        [button('Продолжить черновик', 'resume')],
      ]
    : []),
];
const blank = (kind: Kind): BotDraft => ({
  id: crypto.randomUUID(),
  nonce: nonce(),
  kind,
  stage: 'choose',
  page: 0,
  target: '',
  base: null,
  fields: { done: '', plan: '', problems: '', text: '', value: '', conclusions: '' },
  attachments: [],
});
function currentField(d: BotDraft) {
  return ['done', 'plan', 'problems', 'text', 'value', 'conclusions'].includes(d.stage)
    ? (d.stage as keyof BotDraft['fields'])
    : null;
}
function controls(d: BotDraft): BotButton[][] {
  const field = currentField(d);
  return [
    ...(field && d.fields[field] ? [[button('Оставить прежний текст', `keep:${d.nonce}`)]] : []),
    ...(d.stage === 'plan' || d.stage === 'problems' ? [[button('Пропустить', `skip:${d.nonce}`)]] : []),
    ...(d.stage === 'attachments' ? [[button('Готово', `next:${d.nonce}`)]] : []),
    ...(d.stage !== 'choose' ? [[button('Назад', `back:${d.nonce}`)]] : []),
    [button('Отменить черновик', `cancel:${d.nonce}`)],
  ];
}
function summary(ctx: BotContext, d: BotDraft): BotMessage[] {
  const f = d.fields;
  const task = ctx.tasks.find((t) => t.id === d.target);
  let text =
    d.kind === 'daily'
      ? `Отчёт дня · ${fmt(d.target)}\n\nЧто сделано:\n${f.done}\n\nПлан:\n${f.plan || '—'}\n\nПроблемы:\n${f.problems || '—'}`
      : d.kind === 'weekly'
        ? `Недельный отчёт · ${ctx.reports.find((r) => r.id === d.target)?.districtName ?? d.target}\n\nВыводы:\n${f.conclusions}\n\nПроблемы:\n${f.problems || '—'}\n\nПлан:\n${f.plan || '—'}`
        : `Результат задачи:\n${task?.title ?? d.target}\n\n${f.text}${task?.metricId && f.value ? `\n\n${task.metricName}: ${f.value} ${task.unit ?? ''}` : ''}\n\nМатериалы: ${d.attachments.length}${d.attachments.map((a) => '\n• ' + a.name).join('')}`;
  if (d.kind === 'daily' && d.base) text += '\n\nЭтот отчёт уже есть на сайте. Подтверждение заменит его указанным выше текстом.';
  if (d.replace && d.kind === 'result')
    text += '\n\nДанные задачи обновлены. Проверьте название, показатель и материалы перед отправкой.';
  if (d.replace && d.kind !== 'result') {
    const r = d.kind === 'daily' ? ctx.daily.find((r) => r.day === d.target) : ctx.reports.find((r) => r.id === d.target);
    text +=
      '\n\nНа сайте появилась новая версия. Сверьте её перед заменой:\n' +
      (r
        ? 'done' in r
          ? `Что сделано: ${r.done}\nПлан: ${r.plan}\nПроблемы: ${r.problems}`
          : `Выводы: ${r.conclusions}\nПлан: ${r.plan}\nПроблемы: ${r.problems}`
        : 'Отчёт удалён или недоступен.');
  }
  const chunks = splitText(text).map((text) => ({ text }) as BotMessage);
  chunks.push({
    text:
      d.kind === 'result'
        ? 'Отправить результат на проверку? Подтверждение выполнения останется отдельным действием проверяющего.'
        : 'Проверьте данные и подтвердите отправку.',
    buttons: [[button(d.kind === 'daily' ? 'Сохранить отчёт' : 'Отправить на проверку', `confirm:${d.nonce}`)], ...controls(d)],
  });
  return chunks;
}
function prompt(ctx: BotContext, d: BotDraft, now: Date): BotMessage[] {
  if (d.stage === 'confirm') return summary(ctx, d);
  if (d.stage === 'choose') {
    if (d.kind === 'daily')
      return [
        {
          text: 'За какой день заполнить отчёт?',
          buttons: [
            [0, -1, -2].map((n, i) => button(['Сегодня', 'Вчера', 'Позавчера'][i], `d:${shift(day(now), n)}:${d.nonce}`)),
            ...controls(d),
          ],
        },
      ];
    const list = d.kind === 'result' ? ctx.tasks : ctx.reports;
    if (!list.length)
      return [
        {
          text:
            d.kind === 'result'
              ? 'Нет задач, по которым вы можете сдать результат. Доступны задачи ответственного и соисполнителя в статусе «Новая» или «В работе».'
              : 'Нет доступных черновиков недельных отчётов. Отправленные и принятые отчёты закрыты для изменений.',
          buttons: menus(ctx.me),
        },
      ];
    const page = Math.max(0, Math.min(d.page, Math.ceil(list.length / 8) - 1));
    const choices = list
      .slice(page * 8, page * 8 + 8)
      .map((item) => [
        button(
          'title' in item ? `${item.title.slice(0, 65)} · ${fmt(item.due)}` : `${item.districtName} · с ${fmt(item.weekStart)}`,
          `${d.kind === 'result' ? 't' : 'w'}:${item.id}:${d.nonce}`,
        ),
      ]);
    return [
      {
        text: d.kind === 'result' ? 'Выберите задачу для сдачи результата:' : 'Выберите округ и неделю:',
        buttons: [
          ...choices,
          ...(list.length > 8
            ? [
                [
                  ...(page > 0 ? [button('← Назад', `page:${page - 1}:${d.nonce}`)] : []),
                  ...(page * 8 + 8 < list.length ? [button('Далее →', `page:${page + 1}:${d.nonce}`)] : []),
                ],
              ]
            : []),
          ...controls(d),
        ],
      },
    ];
  }
  const question: Record<string, string> = {
    done: `Что сделано ${fmt(d.target)}? Напишите хотя бы одно предложение.`,
    conclusions: 'Главные выводы за неделю — что удалось сделать?',
    text: `Что сделано по задаче «${ctx.tasks.find((t) => t.id === d.target)?.title ?? d.target}»?`,
    value: `Укажите число для показателя «${ctx.tasks.find((t) => t.id === d.target)?.metricName ?? 'Показатель'}», единица: ${ctx.tasks.find((t) => t.id === d.target)?.unit ?? 'шт.'}.`,
    plan: d.kind === 'weekly' ? 'План на следующую неделю?' : 'План на завтра?',
    problems: 'Какие есть проблемы, где нужна помощь?',
    attachments: `Пришлите ссылки, фото или файл до 10 МБ. Добавлено материалов: ${d.attachments.length}. Затем нажмите «Готово». Можно отправить «-», если материалов нет.`,
  };
  const field = currentField(d);
  return [
    {
      text: question[d.stage] + (field && d.fields[field] ? `\n\nПрежний текст:\n${d.fields[field]}` : ''),
      buttons: controls(d),
    },
  ];
}
function nextStage(ctx: BotContext, d: BotDraft): Stage {
  if (d.kind === 'daily')
    return ({ done: 'plan', plan: 'problems', problems: 'confirm' } as Partial<Record<Stage, Stage>>)[d.stage] ?? 'choose';
  if (d.kind === 'weekly')
    return ({ conclusions: 'problems', problems: 'plan', plan: 'confirm' } as Partial<Record<Stage, Stage>>)[d.stage] ?? 'choose';
  return d.stage === 'text'
    ? ctx.tasks.find((t) => t.id === d.target)?.metricId
      ? 'value'
      : 'attachments'
    : d.stage === 'value'
      ? 'attachments'
      : 'confirm';
}
export function planConversation(ctx: BotContext, input: BotInput, now = new Date()): BotPlan {
  let d = ctx.draft ? structuredClone(ctx.draft) : null;
  const reply = (text: string, buttons?: BotButton[][]): BotPlan => ({ draft: d, reply: [{ text, buttons }] });
  const show = (): BotPlan => ({
    draft: d,
    reply: d ? prompt(ctx, d, now) : [{ text: 'Черновика нет. Выберите действие.', buttons: menus(ctx.me) }],
  });
  const changed = (): BotPlan => {
    if (d) d.nonce = nonce();
    return show();
  };
  const raw = (input.text ?? '').trim();
  const [command, arg] = raw.split(/\s+/, 2);
  const cmd = command?.split('@')[0]?.toLowerCase();
  if (cmd === '/start' && arg) {
    if (!/^[a-f0-9]{24}$/.test(arg))
      return reply('Ссылка подключения некорректна. Создайте новую в профиле на сайте.', menus(ctx.me));
    return {
      draft: null,
      operation: { kind: 'link', code: arg },
      reply: [
        {
          text: 'Telegram подключён. Здесь можно открыть сайт, заполнить отчёт дня или недели и сдать результат задачи. Перед записью бот покажет данные для подтверждения.',
          buttons: [[{ text: 'Открыть сайт', app: '' }], [button('Мои действия', 'start')]],
        },
      ],
    };
  }
  if (cmd === '/stop')
    return {
      draft: null,
      operation: { kind: 'unlink' },
      reply: [
        {
          text: 'Telegram отключён от учётной записи. Для повторного подключения войдите на сайт и откройте «Профиль → Подключить Telegram».',
          buttons: [[{ text: 'Открыть сайт', app: '/profile' }]],
        },
      ],
    };
  const action = input.callback && !input.callback.includes(':') ? input.callback : cmd?.startsWith('/') ? cmd.slice(1) : '';
  if (['start', 'menu', 'help', 'app'].includes(action))
    return reply(
      ctx.me
        ? `${ctx.me.name}, выберите действие. Незавершённый черновик можно продолжить командой /resume. Отменить — /cancel.`
        : 'Откройте сайт, войдите в свой кабинет и выберите «Профиль → Подключить Telegram». Это один раз свяжет вашу учётную запись с ботом. Пароль в сообщениях боту вводить не нужно.',
      menus(ctx.me),
    );
  if (!ctx.me)
    return reply(
      'Учётная запись не подключена или доступ отключён. Войдите на сайт и проверьте подключение Telegram в профиле.',
      menus(null),
    );
  if (action === 'cancel')
    return {
      draft: null,
      reply: [{ text: 'Черновик отменён. Сохранённые на сайте данные не менялись.', buttons: menus(ctx.me) }],
    };
  if (action === 'resume') return show();
  const kind: Kind | null =
    action === 'daily' ? 'daily' : ['tasks', 'result'].includes(action) ? 'result' : action === 'weekly' ? 'weekly' : null;
  if (kind) {
    if ((kind === 'daily' && ctx.me.role === 'member') || (kind === 'weekly' && !['head', 'coordinator'].includes(ctx.me.role)))
      return reply('Этот отчёт недоступен вашей роли.', menus(ctx.me));
    if (d)
      return reply('У вас уже есть незавершённый черновик. Продолжите его или отмените перед заполнением другого.', [
        [button('Продолжить', 'resume')],
        [button('Отменить черновик', `cancel:${d.nonce}`)],
      ]);
    d = blank(kind);
    return show();
  }
  if (!d) return reply('Выберите действие в меню. Черновика для этого сообщения нет.', menus(ctx.me));
  if (input.callback) {
    const [operation, value, token] = input.callback.split(':');
    const supplied = token ?? value;
    if (supplied !== d.nonce) return reply('Кнопка устарела. Продолжите текущий черновик.', [[button('Продолжить', 'resume')]]);
    if (operation === 'cancel') return { draft: null, reply: [{ text: 'Черновик отменён.', buttons: menus(ctx.me) }] };
    if (operation === 'confirm' && d.stage === 'confirm')
      return {
        draft: null,
        operation: { kind: 'submit', nonce: d.nonce },
        reply: [
          {
            text:
              d.kind === 'daily'
                ? 'Отчёт дня сохранён на сайте.'
                : d.kind === 'weekly'
                  ? 'Недельный отчёт отправлен на проверку.'
                  : 'Результат отправлен на проверку. Выполнение подтвердит проверяющий.',
            buttons: menus(ctx.me),
          },
        ],
      };
    if (operation === 'refresh' && d.stage === 'confirm') {
      const latest =
        d.kind === 'result'
          ? ctx.tasks.find((t) => t.id === d!.target)
          : d.kind === 'weekly'
            ? ctx.reports.find((r) => r.id === d!.target)
            : ctx.daily.find((r) => r.day === d!.target);
      if (d.kind !== 'daily' && !latest)
        return reply(
          'Задача или отчёт больше не доступны для отправки. Черновик сохранён; его можно отменить через /cancel.',
          controls(d),
        );
      d.base = latest?.revision ?? null;
      d.replace = true;
      if (d.kind === 'result' && latest && 'metricId' in latest && (d.metric ?? null) !== latest.metricId) {
        d.metric = latest.metricId;
        d.fields.value = '';
        d.stage = latest.metricId ? 'value' : 'attachments';
      }
      return changed();
    }
    if (operation === 'page' && d.stage === 'choose' && /^\d{1,3}$/.test(value)) {
      d.page = +value;
      return changed();
    }
    if (
      operation === 'd' &&
      d.kind === 'daily' &&
      d.stage === 'choose' &&
      [0, -1, -2].some((n) => shift(day(now), n) === value)
    ) {
      const existing = ctx.daily.find((r) => r.day === value);
      d.target = value;
      d.base = existing?.revision ?? null;
      if (existing) d.fields = { ...d.fields, done: existing.done, plan: existing.plan, problems: existing.problems };
      d.stage = 'done';
      return changed();
    }
    if (operation === 't' && d.kind === 'result' && d.stage === 'choose') {
      const task = ctx.tasks.find((t) => t.id === value);
      if (!task) return reply('Задача больше не доступна для сдачи результата. Обновите список через /resume.');
      d.target = value;
      d.base = task.revision;
      d.metric = task.metricId;
      d.stage = 'text';
      return changed();
    }
    if (operation === 'w' && d.kind === 'weekly' && d.stage === 'choose') {
      const r = ctx.reports.find((r) => r.id === value);
      if (!r) return reply('Отчёт уже отправлен или недоступен. Обновите список через /resume.');
      d.target = value;
      d.base = r.revision;
      d.fields = { ...d.fields, conclusions: r.conclusions, plan: r.plan, problems: r.problems };
      d.stage = 'conclusions';
      return changed();
    }
    if (operation === 'back') {
      const stages: Stage[] =
        d.kind === 'daily'
          ? ['choose', 'done', 'plan', 'problems', 'confirm']
          : d.kind === 'weekly'
            ? ['choose', 'conclusions', 'problems', 'plan', 'confirm']
            : [
                'choose',
                'text',
                ...(ctx.tasks.find((t) => t.id === d!.target)?.metricId ? ['value' as Stage] : []),
                'attachments',
                'confirm',
              ];
      d.stage = stages[Math.max(0, stages.indexOf(d.stage) - 1)];
      return changed();
    }
    if (
      (operation === 'keep' && currentField(d) && d.fields[currentField(d)!]) ||
      (operation === 'skip' && ['plan', 'problems'].includes(d.stage)) ||
      (operation === 'next' && d.stage === 'attachments')
    ) {
      if (operation === 'skip') d.fields[currentField(d)!] = '';
      d.stage = nextStage(ctx, d);
      return changed();
    }
    return reply('Эта кнопка не подходит текущему шагу. Нажмите /resume.');
  }
  if (action && action !== 'done')
    return reply('Неизвестная команда. Доступные команды — /help. Черновик сохранён.', [[button('Продолжить', 'resume')]]);
  if (d.stage === 'choose' || d.stage === 'confirm') return show();
  if (!raw && !input.attachment) return show();
  if (input.attachment) {
    if (d.stage !== 'attachments') return reply('Сначала заполните текстовые поля. Материалы можно добавить на следующем шаге.');
    if (d.attachments.length >= 10) return reply('Можно добавить до 10 материалов.', controls(d));
    if (!d.attachments.some((a) => a.id === input.attachment!.id)) d.attachments.push(input.attachment);
    return changed();
  }
  if (d.stage === 'attachments') {
    if (raw === '-' || cmd === '/done') {
      d.stage = 'confirm';
      return changed();
    }
    const links = raw.split(/\s+/).filter(Boolean);
    if (!links.length || links.some((link) => !/^https?:\/\/\S+$/i.test(link) || link.length > 2000))
      return reply('Пришлите ссылку с https://, фото или файл. Для завершения нажмите «Готово».', controls(d));
    if (d.attachments.length + links.length > 10) return reply('Можно добавить до 10 материалов.', controls(d));
    for (const url of links)
      if (!d.attachments.some((a) => a.url === url))
        d.attachments.push({ id: crypto.randomUUID(), name: url, url, kind: 'link' });
    return changed();
  }
  const field = currentField(d);
  if (!field) return show();
  const value = raw === '-' && ['plan', 'problems'].includes(field) ? '' : raw;
  const minimum = field === 'done' ? 10 : field === 'text' ? 5 : field === 'conclusions' ? 1 : 0;
  if (value.length < minimum || value.length > 3000)
    return reply(`Нужно от ${minimum} до 3000 символов. Черновик сохранён.`, controls(d));
  if (field === 'value') {
    const normalized = value.replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(normalized) || !Number.isFinite(+normalized) || +normalized > 1e12)
      return reply('Укажите неотрицательное число, например 12 или 12,5.', controls(d));
    d.fields.value = normalized;
  } else d.fields[field] = value;
  d.stage = nextStage(ctx, d);
  return changed();
}
