import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, FileUp, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import * as P from '../data/perm';
import { importPeople, importTasks, useAppState, type Credential, type TaskInput } from '../data/store';
import type { Priority, Role, User } from '../data/types';
import { go } from '../lib/router';
import { useMe } from '../ui/hooks';
import { Button, Empty, Segmented, toast } from '../ui/kit';

type Entity = 'people' | 'tasks';
interface Col { key: string; label: string; required?: boolean; syn: string[] }
const COLS: Record<Entity, Col[]> = {
  people: [
    { key: 'name', label: 'ФИО', required: true, syn: ['фио', 'имя', 'name', 'сотрудник', 'участник'] },
    { key: 'district', label: 'Округ', syn: ['округ', 'район', 'district', 'го'] },
    { key: 'role', label: 'Роль', syn: ['роль', 'role', 'статус'] },
    { key: 'position', label: 'Должность / направление', syn: ['должность', 'направление', 'position'] },
    { key: 'email', label: 'Почта', syn: ['почта', 'email', 'e-mail', 'эл. почта'] },
    { key: 'phone', label: 'Телефон', syn: ['телефон', 'phone', 'тел'] },
    { key: 'telegram', label: 'Telegram', syn: ['telegram', 'телеграм', 'тг'] },
    { key: 'birthday', label: 'День рождения', syn: ['день рождения', 'дата рождения', 'др', 'birthday'] },
  ],
  tasks: [
    { key: 'title', label: 'Название', required: true, syn: ['задача', 'название', 'title', 'что сделать'] },
    { key: 'assignee', label: 'Ответственный (ФИО или почта)', required: true, syn: ['ответственный', 'исполнитель', 'assignee'] },
    { key: 'district', label: 'Округ', syn: ['округ', 'район', 'district'] },
    { key: 'due', label: 'Срок', required: true, syn: ['срок', 'дедлайн', 'дата', 'due'] },
    { key: 'priority', label: 'Приоритет', syn: ['приоритет', 'priority', 'важность'] },
    { key: 'description', label: 'Описание', syn: ['описание', 'комментарий', 'description'] },
  ],
};

/** «27.10.2026», «2026-10-27», число Excel → YYYY-MM-DD */
function parseDate(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let out: string | null = null;
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) out = `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) out = `${m[1]}-${m[2]}-${m[3]}`;
  // отсекаем несуществующие даты вроде 32.13.1990 или 30.02
  if (!out || isNaN(Date.parse(out)) || new Date(out).toISOString().slice(0, 10) !== out) return null;
  return out;
}
const ROLE_MAP: Record<string, Role> = { руководитель: 'head', координатор: 'coordinator', штаб: 'staff', сотрудник: 'staff', участник: 'member', волонтёр: 'member', волонтер: 'member' };
const PRIO_MAP: Record<string, Priority> = { низкий: 'low', обычный: 'normal', средний: 'normal', высокий: 'high', срочный: 'urgent' };

export default function ImportPage() {
  const s = useAppState();
  const me = useMe();
  const [entity, setEntity] = useState<Entity>('people');
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'skip' | 'update'>('skip');
  const [done, setDone] = useState<{ added: number; updated: number; credentials?: Credential[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (f: File) => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false });
      if (data.length < 2) { toast('В файле нет строк с данными — нужна строка заголовков и хотя бы одна строка ниже.', 'error'); return; }
      const h = (data[0] as unknown[]).map((x) => String(x ?? '').trim());
      setHeader(h); setRows(data.slice(1)); setFileName(f.name); setDone(null);
      autoMap(h, entity);
    } catch {
      toast('Не удалось прочитать файл. Сохраните таблицу как .xlsx или .csv (UTF-8) и попробуйте снова.', 'error');
    }
  };
  const autoMap = (h: string[], e: Entity) => {
    const m: Record<string, number> = {};
    COLS[e].forEach((c) => { const i = h.findIndex((x) => c.syn.some((sy) => x.toLowerCase().includes(sy))); if (i >= 0) m[c.key] = i; });
    setMap(m);
  };

  const findDistrict = (v: unknown) => { const t = String(v ?? '').trim().toLowerCase(); return t ? s.districts.find((d) => d.name.toLowerCase() === t || t.includes(d.name.toLowerCase()))?.id ?? null : null; };
  const findUser = (v: unknown) => { const t = String(v ?? '').trim().toLowerCase(); return t ? s.users.find((u) => u.name.toLowerCase() === t || u.email.toLowerCase() === t) : undefined; };
  const cell = (r: unknown[], k: string) => (map[k] !== undefined ? r[map[k]] : undefined);

  const parsed = useMemo(() => rows.map((r, idx) => {
    const errors: string[] = [];
    let dup = false;
    if (entity === 'people') {
      const name = String(cell(r, 'name') ?? '').trim();
      if (!name) errors.push('нет ФИО');
      const dRaw = cell(r, 'district'); const districtId = findDistrict(dRaw);
      if (dRaw && !districtId) errors.push(`округ «${dRaw}» не найден`);
      if (me.role === 'coordinator' && districtId !== me.districtId) errors.push('координатор импортирует только свой округ');
      const email = String(cell(r, 'email') ?? '').trim();
      if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.push('неверная почта');
      const phone = String(cell(r, 'phone') ?? '').trim();
      const bRaw = cell(r, 'birthday'); const birthday = parseDate(bRaw);
      if (bRaw && !birthday) errors.push('дата рождения не распознана (ДД.ММ.ГГГГ)');
      const role = ROLE_MAP[String(cell(r, 'role') ?? '').trim().toLowerCase().split(' ')[0]] ?? 'member';
      dup = s.users.some((u) => (email && u.email.toLowerCase() === email.toLowerCase()) || (phone && phone.replace(/\D/g, '').length > 9 && u.phone.replace(/\D/g, '') === phone.replace(/\D/g, '')));
      const value: Partial<User> = { name, districtId, email, phone, role, position: String(cell(r, 'position') ?? ''), telegram: String(cell(r, 'telegram') ?? '') || undefined, birthday: birthday ?? undefined };
      return { idx, errors, dup, value, preview: [name, s.districts.find((d) => d.id === districtId)?.name ?? '—', email || phone || '—'] };
    }
    const title = String(cell(r, 'title') ?? '').trim();
    if (!title) errors.push('нет названия');
    const u = findUser(cell(r, 'assignee'));
    if (!u) errors.push(`ответственный «${cell(r, 'assignee') ?? ''}» не найден`);
    const districtId = findDistrict(cell(r, 'district')) ?? u?.districtId ?? null;
    if (!districtId) errors.push('не указан округ');
    else if (!P.canAssignIn(me, districtId)) errors.push('нет прав ставить задачи в этом округе');
    const due = parseDate(cell(r, 'due'));
    if (!due) errors.push('срок не распознан (ДД.ММ.ГГГГ)');
    const priority = PRIO_MAP[String(cell(r, 'priority') ?? '').trim().toLowerCase()] ?? 'normal';
    dup = s.tasks.some((t) => t.title.toLowerCase() === title.toLowerCase() && t.districtId === districtId && t.due === due);
    const value: TaskInput = { title, assigneeId: u?.id ?? '', districtId: districtId ?? '', due: due ?? '', priority, description: String(cell(r, 'description') ?? '') };
    return { idx, errors, dup, value, preview: [title, u?.name ?? '—', due ?? '—'] };
  }), [rows, map, entity, s, me]); // eslint-disable-line

  if (!P.canImport(me)) return <Empty icon={Upload} title="Импорт недоступен" text="Импортировать данные могут координаторы, штаб и руководители." />;
  const valid = parsed.filter((p) => !p.errors.length);
  const dups = valid.filter((p) => p.dup).length;
  const missingRequired = COLS[entity].filter((c) => c.required && map[c.key] === undefined);
  const doImport = async () => {
    setBusy(true);
    try {
      const res = entity === 'people' ? await importPeople(valid.map((p) => p.value as Partial<User>), mode) : importTasks(valid.map((p) => p.value as TaskInput), mode);
      setDone(res);
      toast(`Импорт завершён: добавлено ${res.added}, обновлено ${res.updated}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => go('/settings')} style={{ marginBottom: 10 }}>Настройки</Button>
      <div className="page-head"><div className="grow"><h1>Импорт из таблиц</h1><div className="sub">Постепенный перенос текущих таблиц: люди и задачи</div></div></div>
      <div className="card card-pad col" style={{ gap: 14 }}>
        <div className="row wrap">
          <b>1.</b> Что загружаем:
          <Segmented label="Тип данных" value={entity} onChange={(v) => { setEntity(v); setDone(null); if (header.length) autoMap(header, v); }} options={[{ value: 'people', label: 'Люди' }, { value: 'tasks', label: 'Задачи' }]} />
          <span className="spacer" />
          <Button variant="primary" icon={FileUp} onClick={() => fileRef.current?.click()}>{fileName ? 'Другой файл' : 'Выбрать файл'}</Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
        </div>
        {!fileName && <div className="callout info">Поддерживаются .xlsx, .xls и .csv. Первая строка — заголовки. Пример столбцов для {entity === 'people' ? 'людей: ФИО, Округ, Роль, Почта, Телефон, День рождения' : 'задач: Задача, Ответственный, Округ, Срок, Приоритет'}.</div>}
        {fileName && (
          <>
            <div><b>2.</b> Сопоставьте столбцы файла «{fileName}» ({rows.length} строк)</div>
            <div className="grid g-4" style={{ gap: 10 }}>
              {COLS[entity].map((c) => (
                <label key={c.key} className="field">
                  <span className="label">{c.label}{c.required && <span className="req"> *</span>}</span>
                  <select className={`select select-sm ${c.required && map[c.key] === undefined ? 'invalid' : ''}`} value={map[c.key] ?? ''} onChange={(e) => setMap({ ...map, [c.key]: e.target.value === '' ? (undefined as unknown as number) : +e.target.value })}>
                    <option value="">— не загружать —</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `Столбец ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {missingRequired.length > 0 && <div className="callout danger"><AlertTriangle size={16} />Укажите обязательные столбцы: {missingRequired.map((c) => c.label).join(', ')}.</div>}
            <div><b>3.</b> Проверка: <span className="badge st-done">{valid.length} готовы</span> <span className="badge st-overdue">{parsed.length - valid.length} с ошибками</span> <span className="badge st-review"><Copy size={11} />{dups} дубликатов</span></div>
            <div className="card table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>Строка</th><th>{entity === 'people' ? 'ФИО' : 'Задача'}</th><th>{entity === 'people' ? 'Округ' : 'Ответственный'}</th><th>{entity === 'people' ? 'Контакт' : 'Срок'}</th><th>Проверка</th></tr></thead>
                <tbody>
                  {parsed.slice(0, 200).map((p) => (
                    <tr key={p.idx}>
                      <td className="muted">{p.idx + 2}</td>
                      {p.preview.map((x, i) => <td key={i} className="ellipsis" style={{ maxWidth: 260 }}>{x}</td>)}
                      <td>{p.errors.length ? <span className="small overdue-text">{p.errors.join('; ')}</span> : p.dup ? <span className="badge st-review">дубликат</span> : <span className="badge st-done"><CheckCircle2 size={11} />ок</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row wrap">
              <b>4.</b> Дубликаты:
              <Segmented label="Дубликаты" value={mode} onChange={setMode} options={[{ value: 'skip', label: 'Пропустить' }, { value: 'update', label: 'Обновить существующие' }]} />
              <span className="small muted">{entity === 'people' ? 'Дубликат — совпадает почта или телефон.' : 'Дубликат — то же название, округ и срок.'} Строки с ошибками не загружаются.</span>
              <span className="spacer" />
              <Button variant="primary" icon={Upload} disabled={busy || !valid.length || missingRequired.length > 0} onClick={doImport}>{busy ? 'Импортирую…' : `Импортировать ${valid.length}`}</Button>
            </div>
            {done && <div className="callout ok"><CheckCircle2 size={16} />Готово: добавлено {done.added}, обновлено {done.updated}. <a href={entity === 'people' ? '#/team/people' : '#/tasks'}>Открыть {entity === 'people' ? 'команду' : 'задачи'}</a></div>}
            {!!done?.credentials?.length && (
              <div className="callout warn" style={{ alignItems: 'center' }}>
                <AlertTriangle size={16} />
                <span className="grow">Созданы учётные записи: {done.credentials.length}. Скачайте временные пароли и передайте каждому лично — повторно их не показать (только сбросить).</span>
                <Button size="sm" onClick={() => downloadCredentials(done.credentials!)}>Скачать пароли</Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export function downloadCredentials(list: Credential[]) {
  const site = `${location.origin}${location.pathname}`;
  const csv = '\ufeff' + [['Имя', 'Почта (логин)', 'Временный пароль', 'Адрес'], ...list.map((c) => [c.name, c.email, c.password, site])].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'Доступы_Командный_центр.csv';
  a.click();
}
