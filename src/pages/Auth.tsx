import { AlertTriangle, Clock, LogIn, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { bootstrapHead, register, signIn, signOut, usePhase } from '../data/store';
import { OKRUGS } from '../data/okrugs';
import { Button, Field, Input, Segmented, Select } from '../ui/kit';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-side" aria-hidden>
        <div className="brand"><img className="brand-logo" src={`${import.meta.env.BASE_URL}logo-light.png`} alt="Новые люди · Московская область" /><div className="brand-name">Командный центр</div></div>
        <h1 className="auth-claim">Задачи, результаты и общая картина — <em>в одном месте</em></h1>
      </div>
      <main className="auth-main">{children}</main>
    </div>
  );
}

export default function AuthGate() {
  const { phase, error } = usePhase();
  if (phase === 'loading') return <Shell><div className="auth-card"><div className="spinner" /><p className="muted">Загружаю данные команды…</p></div></Shell>;
  if (phase === 'error')
    return (
      <Shell>
        <div className="auth-card">
          <div className="callout danger"><AlertTriangle size={16} style={{ flex: 'none', marginTop: 2 }} />{error}</div>
          <div className="row" style={{ marginTop: 14 }}>
            <Button variant="primary" icon={RefreshCw} onClick={() => location.reload()}>Обновить</Button>
            <Button onClick={() => signOut()}>Войти другой учётной записью</Button>
          </div>
        </div>
      </Shell>
    );
  if (phase === 'pending')
    return (
      <Shell>
        <div className="auth-card col" style={{ gap: 12 }}>
          <div className="badge badge-brand" style={{ alignSelf: 'flex-start' }}><Clock size={13} />Заявка на рассмотрении</div>
          <h2 style={{ fontSize: 22 }}>{error ? `${error.split(' ')[0]}, заявка отправлена` : 'Заявка отправлена'}</h2>
          <p className="muted" style={{ margin: 0 }}>Её проверит координатор вашего округа или руководство области. Как только доступ откроют, войдите снова — откроется ваш кабинет.</p>
          <div className="row"><Button variant="primary" icon={RefreshCw} onClick={() => location.reload()}>Проверить снова</Button><Button onClick={() => signOut()}>Выйти</Button></div>
        </div>
      </Shell>
    );
  return <Shell>{phase === 'setup' ? <Setup /> : <Entry />}</Shell>;
}

function Entry() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  return (
    <div className="col" style={{ gap: 14, width: '100%', maxWidth: 440 }}>
      <Segmented label="Вход или регистрация" value={mode} onChange={setMode} options={[{ value: 'login', label: 'Вход' }, { value: 'register', label: 'Регистрация' }]} />
      {mode === 'login' ? <Login /> : <Register />}
    </div>
  );
}

function Register() {
  const [kind, setKind] = useState<'okrug' | 'hq'>('okrug');
  const [v, setV] = useState({ name: '', email: '', phone: '', districtId: '', password: '', password2: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof v>) => { setV({ ...v, ...p }); setErrs({}); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (v.name.trim().split(/\s+/).length < 2) x.name = 'Укажите имя и фамилию.';
    if (!/^\S+@\S+\.\S+$/.test(v.email)) x.email = 'Укажите почту — это ваш логин.';
    if (kind === 'okrug' && !v.districtId) x.districtId = 'Выберите свой округ.';
    if (v.password.length < 8) x.password = 'Не короче 8 символов.';
    else if (v.password !== v.password2) x.password2 = 'Пароли не совпадают.';
    setErrs(x);
    if (Object.keys(x).length) return;
    setBusy(true);
    try { await register({ name: v.name.trim(), email: v.email.trim(), phone: v.phone, districtId: kind === 'okrug' ? v.districtId : null }, kind, v.password); }
    catch (y) { setErrs({ form: (y as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <form className="auth-card col" style={{ gap: 14 }} onSubmit={submit}>
      <h2 style={{ fontSize: 22 }}>Регистрация</h2>
      <p className="muted" style={{ margin: 0 }}>После отправки заявку проверит координатор округа или руководство области — затем откроется доступ.</p>
      <div className="field"><span className="label">Кто вы</span>
        <Segmented label="Кто вы" value={kind} onChange={(k) => { setKind(k); setErrs({}); }} options={[{ value: 'okrug', label: 'Участник округа' }, { value: 'hq', label: 'Сотрудник штаба МО' }]} />
      </div>
      {kind === 'okrug' && (
        <Field label="Ваш округ" required error={errs.districtId}>
          <Select value={v.districtId} invalid={!!errs.districtId} onChange={(e) => set({ districtId: e.target.value })} options={[{ value: '', label: 'Выберите округ' }, ...OKRUGS.map((o) => ({ value: o.id, label: `${o.num} ${o.name} — ${o.cities.slice(0, 3).join(', ')}${o.cities.length > 3 ? '…' : ''}` }))]} />
        </Field>
      )}
      <Field label="Имя и фамилия" required error={errs.name}><Input value={v.name} invalid={!!errs.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Почта (логин)" required error={errs.email}><Input type="email" autoComplete="username" value={v.email} invalid={!!errs.email} onChange={(e) => set({ email: e.target.value })} /></Field>
      <Field label="Телефон"><Input type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+7 (900) 000-00-00" /></Field>
      <div className="grid g-2" style={{ gap: 12 }}>
        <Field label="Пароль" required error={errs.password}><Input type="password" autoComplete="new-password" value={v.password} invalid={!!errs.password} onChange={(e) => set({ password: e.target.value })} /></Field>
        <Field label="Повторите пароль" required error={errs.password2}><Input type="password" autoComplete="new-password" value={v.password2} invalid={!!errs.password2} onChange={(e) => set({ password2: e.target.value })} /></Field>
      </div>
      {errs.form && <div className="callout danger"><AlertTriangle size={16} />{errs.form}</div>}
      <Button variant="primary" icon={UserPlus} type="submit" disabled={busy}>{busy ? 'Отправляю…' : 'Отправить заявку'}</Button>
    </form>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setErr('Введите почту и пароль.'); return; }
    setBusy(true); setErr('');
    try { await signIn(email, password); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="auth-card col" style={{ gap: 14 }} onSubmit={submit}>
      <h2 style={{ fontSize: 22 }}>Вход</h2>
      <p className="muted" style={{ margin: 0 }}>Войдите почтой и паролем. Если учётной записи ещё нет — нажмите «Регистрация» выше.</p>
      <Field label="Рабочая почта"><Input type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Пароль" error={err}><Input type="password" autoComplete="current-password" value={password} invalid={!!err} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Button variant="primary" icon={LogIn} type="submit" disabled={busy}>{busy ? 'Вхожу…' : 'Войти'}</Button>
    </form>
  );
}

function Setup() {
  const [v, setV] = useState({ name: '', email: '', phone: '', password: '', password2: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (v.name.trim().split(/\s+/).length < 2) x.name = 'Укажите имя и фамилию.';
    if (!/^\S+@\S+\.\S+$/.test(v.email)) x.email = 'Укажите рабочую почту — это ваш логин.';
    if (v.password.length < 8) x.password = 'Не короче 8 символов.';
    else if (v.password !== v.password2) x.password2 = 'Пароли не совпадают.';
    setErrs(x);
    if (Object.keys(x).length) return;
    setBusy(true);
    try { await bootstrapHead({ name: v.name.trim(), email: v.email.trim(), phone: v.phone, position: 'Руководитель регионального отделения' }, v.password); }
    catch (y) { setErrs({ form: (y as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <form className="auth-card col" style={{ gap: 14 }} onSubmit={submit}>
      <div className="badge badge-brand" style={{ alignSelf: 'flex-start' }}><ShieldCheck size={13} />Первый запуск</div>
      <h2 style={{ fontSize: 22 }}>Создайте учётную запись руководителя</h2>
      <p className="muted" style={{ margin: 0 }}>Это делается один раз. Затем вы добавите координаторов и команду в разделе «Команда» — каждому выдаётся логин и временный пароль.</p>
      <Field label="Имя и фамилия" error={errs.name}><Input autoFocus value={v.name} invalid={!!errs.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Рабочая почта (логин)" error={errs.email}><Input type="email" autoComplete="username" value={v.email} invalid={!!errs.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
      <Field label="Телефон"><Input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
      <div className="grid g-2" style={{ gap: 12 }}>
        <Field label="Пароль" error={errs.password}><Input type="password" autoComplete="new-password" value={v.password} invalid={!!errs.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></Field>
        <Field label="Повторите пароль" error={errs.password2}><Input type="password" autoComplete="new-password" value={v.password2} invalid={!!errs.password2} onChange={(e) => setV({ ...v, password2: e.target.value })} /></Field>
      </div>
      {errs.form && <div className="callout danger"><AlertTriangle size={16} />{errs.form}</div>}
      <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Создаю…' : 'Создать и войти'}</Button>
    </form>
  );
}
