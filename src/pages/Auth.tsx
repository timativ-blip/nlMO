import { AlertTriangle, LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { bootstrapHead, signIn, signOut, usePhase } from '../data/store';
import { Button, Field, Input } from '../ui/kit';

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
  return <Shell>{phase === 'setup' ? <Setup /> : <Login />}</Shell>;
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
      <p className="muted" style={{ margin: 0 }}>Логин и временный пароль выдаёт руководитель или координатор округа. После входа пароль можно сменить в профиле.</p>
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
