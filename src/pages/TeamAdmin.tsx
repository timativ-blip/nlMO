// Управление командой: добавление сотрудника (с выдачей временного пароля), роль, округ, доступ.
import { Copy, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { addPerson, canAddPerson, DEMO_MODE, resetPassword, setUserAdmin, useAppState } from '../data/store';
import type { Role, User } from '../data/types';
import { ROLE_LABEL } from '../data/types';
import { useLookup, useMe } from '../ui/hooks';
import { Button, Field, Input, Modal, run, Select, toast } from '../ui/kit';

export function AddPersonButton() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (!canAddPerson(me)) return null;
  return (
    <>
      <Button variant="primary" icon={UserPlus} onClick={() => setOpen(true)}>Добавить человека</Button>
      {open && <AddPersonModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AddPersonModal({ onClose }: { onClose: () => void }) {
  const s = useAppState();
  const me = useMe();
  const head = me.role === 'head';
  const [v, setV] = useState<Partial<User>>({ name: '', email: '', phone: '', position: '', role: 'member', districtId: head ? '' : me.districtId });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);
  const set = (p: Partial<User>) => { setV({ ...v, ...p }); setErrs({}); };
  const needsDistrict = v.role === 'member' || v.role === 'coordinator';
  const save = async () => {
    const e: Record<string, string> = {};
    if (!v.name || v.name.trim().split(/\s+/).length < 2) e.name = 'Укажите имя и фамилию.';
    if (!v.email || !/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Нужна рабочая почта — это логин для входа.';
    if (needsDistrict && !v.districtId) e.districtId = 'Выберите округ.';
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await addPerson({ ...v, districtId: needsDistrict || v.districtId ? v.districtId : null });
      setCreated({ name: v.name!, email: v.email!, password: r.password });
      toast(`${v.name} добавлен(а) в команду`);
    } catch (x) {
      setErrs({ form: (x as Error).message });
    } finally { setBusy(false); }
  };
  if (created) return <PasswordModal title="Сотрудник добавлен" person={created} onClose={onClose} />;
  const roles: Role[] = head ? ['member', 'coordinator', 'staff', 'head'] : ['member'];
  return (
    <Modal open onClose={onClose} title="Добавить человека" width={600} footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary" icon={UserPlus} disabled={busy} onClick={save}>{busy ? 'Создаю…' : 'Добавить'}</Button></>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="grid g-2" style={{ gap: 12 }}>
          <Field label="Имя и фамилия" required error={errs.name}><Input autoFocus value={v.name} invalid={!!errs.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Рабочая почта (логин)" required error={errs.email}><Input type="email" value={v.email} invalid={!!errs.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Роль"><Select disabled={!head} value={v.role} onChange={(e) => set({ role: e.target.value as Role })} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></Field>
          <Field label="Округ" required={needsDistrict} error={errs.districtId} hint={!head ? 'Координатор добавляет участников своего округа' : !needsDistrict ? 'Для штаба и руководителей — необязательно' : undefined}>
            <Select disabled={!head} value={v.districtId ?? ''} invalid={!!errs.districtId} onChange={(e) => set({ districtId: e.target.value || null })} options={[{ value: '', label: needsDistrict ? 'Выберите округ' : 'Вся область' }, ...s.districts.map((d) => ({ value: d.id, label: d.name }))]} />
          </Field>
          <Field label="Должность или направление"><Input value={v.position} onChange={(e) => set({ position: e.target.value })} /></Field>
          <Field label="Телефон"><Input type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>После создания вы получите временный пароль — передайте его сотруднику лично. Писем система не рассылает.</p>
        {errs.form && <div className="callout danger">{errs.form}</div>}
      </div>
    </Modal>
  );
}

export function PasswordModal({ title, person, onClose }: { title: string; person: { name: string; email: string; password: string }; onClose: () => void }) {
  const site = `${location.origin}${location.pathname}`;
  const text = `Командный центр | Московская область\n${site}\nЛогин: ${person.email}\nВременный пароль: ${person.password}\nПосле входа смените пароль в профиле.`;
  return (
    <Modal open onClose={onClose} title={title} footer={<Button variant="primary" onClick={onClose}>Готово</Button>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="callout warn"><KeyRound size={16} style={{ flex: 'none', marginTop: 2 }} /><span>Передайте эти данные <b>{person.name}</b> лично. Пароль показывается один раз — если потеряется, его можно сбросить в карточке сотрудника.</span></div>
        <div className="formula">{DEMO_MODE ? 'Деморежим: учётная запись не создаётся.\n' : ''}{text}</div>
        <div><Button icon={Copy} onClick={() => navigator.clipboard.writeText(text).then(() => toast('Скопировано'), () => toast('Не удалось скопировать — выделите текст вручную', 'error'))}>Скопировать</Button></div>
      </div>
    </Modal>
  );
}

/** Карточка руководителя/координатора в профиле сотрудника */
export function PersonAdminCard({ u }: { u: User }) {
  const s = useAppState();
  const me = useMe();
  const L = useLookup();
  const [pw, setPw] = useState<string | null>(null);
  const head = me.role === 'head';
  const coordCan = me.role === 'coordinator' && u.role === 'member' && u.districtId === me.districtId;
  if (!head && !coordCan) return null;
  if (u.id === me.id && !head) return null;
  const reset = async () => {
    if (!confirm(`Сбросить пароль для ${u.name}? Старый пароль перестанет работать.`)) return;
    try { setPw(await resetPassword(u.id)); } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <div className="card card-pad col" style={{ gap: 12, marginTop: 16 }}>
      <h2 className="row"><ShieldCheck size={18} />Доступ и роль</h2>
      {head && (
        <div className="grid g-3" style={{ gap: 12 }}>
          <Field label="Роль"><Select value={u.role} onChange={(e) => run(() => setUserAdmin(u.id, { role: e.target.value as Role }), 'Роль изменена')} options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></Field>
          <Field label="Округ"><Select value={u.districtId ?? ''} onChange={(e) => run(() => setUserAdmin(u.id, { districtId: e.target.value || null }), 'Округ изменён')} options={[{ value: '', label: 'Вся область' }, ...s.districts.map((d) => ({ value: d.id, label: d.name }))]} /></Field>
          <Field label="Доступ"><Select value={u.active ? 'on' : 'off'} onChange={(e) => run(() => setUserAdmin(u.id, { active: e.target.value === 'on' }), e.target.value === 'on' ? 'Доступ включён' : 'Доступ отключён — человек больше не сможет войти')} options={[{ value: 'on', label: 'Активен' }, { value: 'off', label: 'Отключён' }]} /></Field>
        </div>
      )}
      {u.role === 'coordinator' && u.districtId && <span className="small muted">Координатор округа {L.dname(u.districtId)}.</span>}
      <div className="row wrap"><Button icon={KeyRound} onClick={reset}>Сбросить пароль</Button><span className="small muted">Выдаст новый временный пароль.</span></div>
      {pw && <PasswordModal title="Новый пароль" person={{ name: u.name, email: u.email, password: pw }} onClose={() => setPw(null)} />}
    </div>
  );
}
