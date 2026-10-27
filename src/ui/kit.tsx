import { AlertCircle, AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Minus, X, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppError } from '../data/store';
import type { Priority, ReportStatus, Task, TaskStatus, User } from '../data/types';
import { PRIORITY_LABEL, REPORT_STATUS_LABEL, STATUS_LABEL } from '../data/types';
import { isOverdue } from '../data/calc';

/* ───────── Тосты ───────── */
type ToastT = { id: number; text: string; kind: 'ok' | 'error' };
let pushToast: (t: Omit<ToastT, 'id'>) => void = () => {};
export const toast = (text: string, kind: ToastT['kind'] = 'ok') => pushToast({ text, kind });

export function Toaster() {
  const [items, setItems] = useState<ToastT[]>([]);
  useEffect(() => {
    let n = 0;
    pushToast = (t) => {
      const id = ++n;
      setItems((x) => [...x.slice(-2), { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.kind === 'error' ? 6000 : 3200);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'ok' ? <CheckCircle2 size={18} color="#7fd6cc" /> : <AlertCircle size={18} />}
          <span className="grow">{t.text}</span>
          <button className="btn-ghost" style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer' }} aria-label="Закрыть" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Выполнить действие, показать подтверждение или понятную ошибку. */
export function run(fn: () => void, ok?: string) {
  try {
    fn();
    if (ok) toast(ok);
    return true;
  } catch (e) {
    toast(e instanceof AppError ? e.message : 'Что-то пошло не так. Обновите страницу и попробуйте снова.', 'error');
    if (!(e instanceof AppError)) console.error(e);
    return false;
  }
}

/* ───────── Кнопки ───────── */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md'; icon?: LucideIcon; iconOnly?: boolean };
export function Button({ variant = 'secondary', size = 'md', icon: Icon, iconOnly, className = '', children, ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${iconOnly ? 'btn-icon' : ''} ${className}`} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 15 : 17} strokeWidth={2.2} aria-hidden />}
      {children}
    </button>
  );
}

/* ───────── Бейджи ───────── */
export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge st-${status}`}><span className="dot" />{STATUS_LABEL[status]}</span>;
}
export function TaskStatusBadges({ t }: { t: Task }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <StatusBadge status={t.status} />
      {isOverdue(t) && <span className="badge st-overdue"><AlertTriangle size={12} />Просрочена</span>}
      {t.returnedAt && t.status === 'in_progress' && <span className="badge st-returned">На доработке</span>}
    </span>
  );
}
export function ReportBadge({ status }: { status: ReportStatus }) {
  return <span className={`badge st-${status}`}><span className="dot" />{REPORT_STATUS_LABEL[status]}</span>;
}
export function PriorityTag({ p }: { p: Priority }) {
  const Icon = p === 'urgent' || p === 'high' ? ArrowUp : p === 'low' ? ArrowDown : Minus;
  return <span className={`prio prio-${p}`}><Icon size={13} strokeWidth={2.6} />{PRIORITY_LABEL[p]}</span>;
}

/* ───────── Аватар ───────── */
const AV_COLORS = ['#087e74', '#0e4742', '#1d7a8c', '#5c6f2b', '#7a4a8c', '#a35407', '#26799e', '#3d5a80'];
export function Avatar({ user, size = 32 }: { user?: User | null; size?: number }) {
  if (!user) return <span className="avatar" style={{ width: size, height: size, background: '#cbd6d3' }} />;
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  const color = AV_COLORS[[...user.id].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
  return (
    <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.38 }} title={user.name}>
      {user.photo ? <img src={user.photo} alt="" /> : initials}
    </span>
  );
}

/* ───────── Модалка и панель ───────── */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), textarea, select, button.btn-primary') ?? ref.current;
      el?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      // Реагирует только верхнее окно (модалка поверх панели задачи)
      const stack = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (stack[stack.length - 1] !== ref.current) return;
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]); // eslint-disable-line
  return ref;
}

export function Modal({ open, onClose, title, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useDialog(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 className="grow">{title}</h2>
          <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Закрыть" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, head, children }: { open: boolean; onClose: () => void; head: ReactNode; children: ReactNode }) {
  const ref = useDialog(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div className="grow row">{head}</div>
          <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Закрыть панель" onClick={onClose} />
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}

/* ───────── Поля ───────── */
let fid = 0;
const FieldCtx = createContext<string>('');
export const useFieldId = () => useContext(FieldCtx);
export function Field({ label, hint, error, required, children, style }: { label: string; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; style?: React.CSSProperties }) {
  const [id] = useState(() => `f${++fid}`);
  return (
    <FieldCtx.Provider value={id}>
      <div className="field" style={style}>
        <label htmlFor={id}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
        {children}
        {error ? <span className="err" id={`${id}-err`} role="alert"><AlertCircle size={14} style={{ marginTop: 2, flex: 'none' }} />{error}</span> : hint ? <span className="hint">{hint}</span> : null}
      </div>
    </FieldCtx.Provider>
  );
}
export function Input({ invalid, className = '', ...p }: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const id = useFieldId();
  return <input id={id || undefined} className={`input ${invalid ? 'invalid' : ''} ${className}`} aria-invalid={invalid || undefined} aria-describedby={invalid && id ? `${id}-err` : undefined} {...p} />;
}
export function Textarea({ invalid, className = '', ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const id = useFieldId();
  return <textarea id={id || undefined} className={`textarea ${invalid ? 'invalid' : ''} ${className}`} aria-invalid={invalid || undefined} {...p} />;
}
export function Select({ invalid, className = '', options, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; options: { value: string; label: string }[] }) {
  const id = useFieldId();
  return (
    <select id={id || undefined} className={`select ${invalid ? 'invalid' : ''} ${className}`} aria-invalid={invalid || undefined} {...p}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: LucideIcon }[]; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <o.icon size={15} />}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={value === t.value ? 'on' : ''} onClick={() => onChange(t.value)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Empty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={24} /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

export function Bar({ value, tone }: { value: number; tone?: 'warn' | 'bad' }) {
  const v = Math.max(0, Math.min(1, value));
  return <div className={`bar ${tone ?? (value < 0.5 ? 'bad' : value < 0.8 ? 'warn' : '')}`} role="meter" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${v * 100}%` }} /></div>;
}

/** Небольшой поповер с закрытием по клику снаружи и Esc */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref };
}
