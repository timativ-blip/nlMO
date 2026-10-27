import { Camera, CheckCircle2, Database, Download, KeyRound, MapPin, Plus, RefreshCw, Save, Send, Upload, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as P from '../data/perm';
import { InstallHelp } from '../ui/onboarding';
import { addDistrict, changePassword, connectTelegram, DEMO_MODE, disconnectTelegram, getState, renameDistrict, resetDemo, setUi, setupBot, updateUser, useAppState } from '../data/store';
import type { BirthdayVisibility, Notification } from '../data/types';
import { roleLabel } from '../data/types';
import { fmtStamp } from '../lib/date';
import { go } from '../lib/router';
import { useLookup, useMe } from '../ui/hooks';
import { Avatar, Button, Field, Input, run, Select, toast } from '../ui/kit';
import { fileToAvatar } from '../ui/widgets';

export function ProfilePage() {
  const me = useMe();
  const L = useLookup();
  const [v, setV] = useState(me);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setV(me), [me.id]); // eslint-disable-line
  const dirty = JSON.stringify(v) !== JSON.stringify(me);
  const save = () => {
    const e: Record<string, string> = {};
    if (v.name.trim().split(/\s+/).length < 2) e.name = 'Укажите имя и фамилию через пробел.';
    if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Проверьте адрес: пример — name@example.ru';
    if (v.phone && v.phone.replace(/\D/g, '').length < 10) e.phone = 'В номере должно быть не меньше 10 цифр.';
    setErrs(e);
    if (Object.keys(e).length) return;
    run(() => updateUser(me.id, { name: v.name.trim(), position: v.position, email: v.email, phone: v.phone, telegram: v.telegram, birthday: v.birthday || undefined, birthdayVisibility: v.birthdayVisibility, photo: v.photo }), 'Профиль сохранён');
  };
  return (
    <>
      <div className="page-head"><div className="grow"><h1>Профиль</h1><div className="sub">{roleLabel(me)} · {L.dname(me.districtId)}</div></div><Button variant="primary" icon={Save} disabled={!dirty} onClick={save}>Сохранить</Button></div>
      <div className="grid g-main">
        <div className="card card-pad col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 16 }}>
            <Avatar user={v} size={84} />
            <div className="col">
              <Button icon={Camera} onClick={() => fileRef.current?.click()}>Загрузить фото</Button>
              {v.photo && <Button variant="ghost" size="sm" onClick={() => setV({ ...v, photo: undefined })}>Убрать фото</Button>}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setV({ ...v, photo: await fileToAvatar(f) }); }} />
            </div>
          </div>
          <div className="grid g-2" style={{ gap: 12 }}>
            <Field label="Имя и фамилия" required error={errs.name}><Input value={v.name} invalid={!!errs.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="Должность или направление"><Input value={v.position} onChange={(e) => setV({ ...v, position: e.target.value })} /></Field>
            <Field label="Рабочая почта" error={errs.email}><Input type="email" value={v.email} invalid={!!errs.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Телефон" error={errs.phone}><Input type="tel" value={v.phone} invalid={!!errs.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="+7 (900) 000-00-00" /></Field>
            <Field label="Telegram"><Input value={v.telegram ?? ''} onChange={(e) => setV({ ...v, telegram: e.target.value })} placeholder="@username" /></Field>
            <Field label="Роль и округ" hint="Меняет руководитель области"><Input value={`${roleLabel(me)} · ${L.dname(me.districtId)}`} disabled /></Field>
          </div>
        </div>
        <div className="card card-pad col" style={{ gap: 12 }}>
          <h2>День рождения</h2>
          <p className="small muted" style={{ margin: 0 }}>Необязательно. Если указать, коллеги увидят дату в календаре — в соответствии с настройкой видимости. Год рождения не показывается.</p>
          <Field label="Дата"><Input type="date" value={v.birthday ?? ''} onChange={(e) => setV({ ...v, birthday: e.target.value || undefined })} /></Field>
          <Field label="Кто видит"><Select value={v.birthdayVisibility} onChange={(e) => setV({ ...v, birthdayVisibility: e.target.value as BirthdayVisibility })} options={[{ value: 'all', label: 'Вся команда области' }, { value: 'district', label: 'Только мой округ' }, { value: 'hidden', label: 'Никто' }]} /></Field>
        </div>
      </div>
      {!DEMO_MODE && <div className="grid g-2" style={{ marginTop: 16 }}><TelegramCard /><PasswordCard /></div>}
      <div className="card card-pad col" style={{ gap: 10, marginTop: 16 }}><h2 className="row"><Smartphone size={18} />Приложение на телефоне</h2><p className="small muted" style={{ margin: 0 }}>Установите командный центр как приложение — иконка на экране, открывается без браузера.</p><InstallHelp /></div>
    </>
  );
}

function TelegramCard() {
  const s = useAppState();
  const [busy, setBusy] = useState(false);
  const linked = !!s.extras?.telegramLinked;
  const connect = async () => {
    // Окно открываем сразу, иначе браузер заблокирует его как всплывающее
    const w = window.open('', '_blank');
    setBusy(true);
    try {
      const url = await connectTelegram();
      if (w) w.location.href = url; else location.href = url;
      toast('Нажмите «Старт» в Telegram — бот подтвердит подключение');
    } catch (e) {
      w?.close();
      toast((e as Error).message, 'error');
    } finally { setBusy(false); }
  };
  return (
    <div className="card card-pad col" style={{ gap: 10 }}>
      <h2 className="row"><Send size={18} />Уведомления в Telegram</h2>
      {linked ? (
        <>
          <div className="callout ok"><CheckCircle2 size={16} />Подключено. Назначения, сроки, комментарии и решения по проверке приходят в Telegram.</div>
          <div><Button variant="ghost" onClick={async () => { try { await disconnectTelegram(); toast('Telegram отключён'); } catch (e) { toast((e as Error).message, 'error'); } }}>Отключить</Button></div>
        </>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>Уведомления продублируются в Telegram. Если Telegram работает с перебоями, все уведомления остаются в колокольчике приложения.</p>
          <div><Button variant="primary" icon={Send} disabled={busy} onClick={connect}>{busy ? 'Открываю…' : 'Подключить Telegram'}</Button></div>
          {!s.extras?.telegramBot && <span className="small muted">Бот ещё не подключён руководителем области.</span>}
        </>
      )}
    </div>
  );
}

function PasswordCard() {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    if (p1.length < 8) return setErr('Не короче 8 символов.');
    if (p1 !== p2) return setErr('Пароли не совпадают.');
    try { await changePassword(p1); setP1(''); setP2(''); setErr(''); toast('Пароль изменён'); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="card card-pad col" style={{ gap: 10 }}>
      <h2 className="row"><KeyRound size={18} />Пароль</h2>
      <div className="grid g-2" style={{ gap: 10 }}>
        <Field label="Новый пароль"><Input type="password" autoComplete="new-password" value={p1} onChange={(e) => { setP1(e.target.value); setErr(''); }} /></Field>
        <Field label="Повторите" error={err}><Input type="password" autoComplete="new-password" value={p2} invalid={!!err} onChange={(e) => { setP2(e.target.value); setErr(''); }} /></Field>
      </div>
      <div><Button onClick={save} disabled={!p1}>Сменить пароль</Button></div>
    </div>
  );
}

function BotCard() {
  const s = useAppState();
  const [busy, setBusy] = useState(false);
  const bot = s.extras?.telegramBot;
  const setup = async () => {
    setBusy(true);
    try { const name = await setupBot(); toast(`Бот @${name} подключён`); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="card card-pad col" style={{ gap: 10 }}>
      <h2 className="row"><Send size={18} />Telegram-бот</h2>
      {bot ? <div className="callout ok"><CheckCircle2 size={16} />Подключён бот <a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">@{bot}</a>. Сотрудники подключаются в своём профиле.</div>
        : <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>В Telegram откройте @BotFather → /newbot, задайте имя и получите токен.</li>
            <li>В Supabase: Edge Functions → Secrets → добавьте <code>TELEGRAM_BOT_TOKEN</code> с этим токеном.</li>
            <li>Нажмите кнопку ниже.</li>
          </ol>}
      <div><Button variant={bot ? 'secondary' : 'primary'} icon={RefreshCw} disabled={busy} onClick={setup}>{busy ? 'Подключаю…' : bot ? 'Переподключить' : 'Подключить бота'}</Button></div>
    </div>
  );
}

function DistrictsCard() {
  const s = useAppState();
  const L = useLookup();
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  return (
    <div className="card card-pad col" style={{ gap: 10 }}>
      <h2 className="row"><MapPin size={18} />Округа · {s.districts.length}</h2>
      <p className="small muted" style={{ margin: 0 }}>Координатор округа назначается в карточке сотрудника (роль и округ).</p>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {s.districts.map((d) => (
          <div key={d.id} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
            {edit?.id === d.id ? (
              <form className="row grow" onSubmit={(e) => { e.preventDefault(); if (run(() => renameDistrict(d.id, edit.name), 'Название сохранено')) setEdit(null); }}>
                <input className="input input-sm" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus aria-label="Название округа" />
                <Button size="sm" type="submit">Сохранить</Button>
              </form>
            ) : (
              <>
                <b className="grow">{d.name}</b>
                <span className="small muted">{L.user(d.coordinatorId)?.name ?? 'координатор не назначен'}</span>
                <Button size="sm" variant="ghost" onClick={() => setEdit({ id: d.id, name: d.name })}>Переименовать</Button>
              </>
            )}
          </div>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (run(() => addDistrict(name), 'Округ добавлен')) setName(''); }}>
        <input className="input" placeholder="Новый округ, например «Дубна»" value={name} onChange={(e) => setName(e.target.value)} aria-label="Новый округ" />
        <Button icon={Plus} type="submit">Добавить</Button>
      </form>
    </div>
  );
}

const NOTIFY_LABEL: Record<Notification['kind'], string> = { assign: 'Назначение задачи', deadline: 'Сроки и их изменения', comment: 'Комментарии', review: 'Проверка результата', event: 'Изменения мероприятий', report: 'Отчёты' };

export function SettingsPage() {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  return (
    <>
      <div className="page-head"><div className="grow"><h1>Настройки</h1></div></div>
      <div className="grid g-2">
        <div className="card card-pad col" style={{ gap: 10 }}>
          <h2>Уведомления</h2>
          <p className="small muted" style={{ margin: 0 }}>Какие события показывать в колокольчике. Telegram подключается в профиле.</p>
          {(Object.keys(NOTIFY_LABEL) as Notification['kind'][]).map((k) => (
            <label key={k} className="check"><input type="checkbox" checked={s.ui.notify[k]} onChange={(e) => { setUi({ notify: { ...s.ui.notify, [k]: e.target.checked } }); toast('Настройка сохранена'); }} />{NOTIFY_LABEL[k]}</label>
          ))}
        </div>
        {P.canImport(me) && (
          <div className="card card-pad col" style={{ gap: 10 }}>
            <h2>Перенос данных из таблиц</h2>
            <p className="small muted" style={{ margin: 0 }}>Загрузите CSV или XLSX: сопоставьте столбцы, проверьте ошибки и дубликаты, затем импортируйте.</p>
            <div><Button variant="primary" icon={Upload} onClick={() => go('/import')}>Импорт CSV / XLSX</Button></div>
          </div>
        )}
        {!DEMO_MODE && me.role === 'head' && <BotCard />}
        {me.role === 'head' && <DistrictsCard />}
        {DEMO_MODE && (
          <div className="card card-pad col" style={{ gap: 10 }}>
            <h2>Демо-данные</h2>
            <p className="small muted" style={{ margin: 0 }}>Данные хранятся только в этом браузере. Сброс вернёт исходный набор: 8 округов, ~45 человек, задачи, мероприятия и отчёты.</p>
            <div className="row wrap">
              <Button icon={Download} onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(getState(), null, 1)], { type: 'application/json' })); a.download = 'kc-mo-backup.json'; a.click(); }}>Скачать резервную копию</Button>
              <Button variant="danger" icon={RefreshCw} onClick={() => { if (confirm('Сбросить все изменения и вернуть демо-данные?')) { resetDemo(); toast('Демо-данные восстановлены'); } }}>Сбросить демо</Button>
            </div>
          </div>
        )}
        {me.role === 'head' && (
          <div className="card card-pad col" style={{ gap: 6 }}>
            <h2 className="row"><Database size={18} />Журнал значимых изменений</h2>
            {s.audit.length === 0 && <span className="small muted">Пока пусто — здесь появятся действия пользователей.</span>}
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {s.audit.slice(0, 50).map((a, i) => <div key={i} className="small" style={{ padding: '5px 0', borderTop: i ? '1px solid var(--border)' : 0 }}><b>{L.user(a.userId)?.name}</b> · {a.entity}: {a.text} <span className="muted">· {fmtStamp(a.at)}</span></div>)}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
