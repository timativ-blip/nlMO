import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { sb, FUNCTIONS_URL } from '../lib/supabase';
import { DEMO_MODE } from '../data/store';
import type { PdData } from '../data/media-types';
import { withDeadline } from '../lib/deadline';
import { useMe } from '../ui/hooks';
import { Button, Field, Input, Modal, Select, toast } from '../ui/kit';

export function MediaAuthorForm({ data }: { data: PdData }) {
  const me = useMe(), [open, setOpen] = useState(false), [name, setName] = useState(''), [group, setGroup] = useState(me.role === 'coordinator' ? me.districtId ?? '' : '');
  const [ready, setReady] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const allowed = me.active && !me.pending && ['head', 'staff', 'coordinator'].includes(me.role);
  useEffect(() => {
    if (!open || DEMO_MODE || !sb) return;
    let alive = true; setLoading(true); setError('');
    void sb.functions.invoke('media-authors', { body: { action: 'status' } }).then(({ data: status, error: failure }) => {
      if (!alive) return;
      setReady(!failure && status?.ready === true);
      if (failure) setError('Не удалось проверить связь с таблицей. Закройте форму и попробуйте ещё раз.');
    }).catch(() => { if (alive) { setReady(false); setError('Не удалось проверить связь с таблицей. Попробуйте ещё раз.'); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);
  if (!allowed) return null;
  const save = async () => {
    if (!sb || DEMO_MODE || !ready) return;
    setBusy(true); setError('');
    try {
      const result = await withDeadline(async signal => {
        const { data: session } = await sb!.auth.getSession();
        if (!session.session) throw new Error('Войдите на сайт снова.');
        const response = await fetch(`${FUNCTIONS_URL}/media-authors`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_KEY }, body: JSON.stringify({ action: 'add', name, groupId: group }) });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Таблица не подтвердила запись. Проверьте список перед повторной попыткой.');
        return value;
      }, 50000, 'Не удалось дождаться подтверждения. Проверьте список перед повторной попыткой.');
      if (!result?.saved) throw new Error(result?.error || 'Таблица не подтвердила запись.');
      if (result.timeline) window.dispatchEvent(new CustomEvent('media-authors-changed', { detail: result.timeline }));
      toast(result.exists ? 'Этот автор уже есть в списке округа' : 'Автор добавлен в Google Таблицу');
      setOpen(false); setName('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <><Button size="sm" icon={UserPlus} onClick={() => setOpen(true)}>Добавить автора</Button><Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="Добавить автора округа" footer={<><Button disabled={busy} onClick={() => setOpen(false)}>Отмена</Button><Button variant="primary" disabled={busy || loading || !ready || !group || name.trim().split(/\s+/).length < 2} onClick={save}>{busy ? 'Сохраняем в таблицу…' : 'Добавить в таблицу'}</Button></>}>
    <p className="muted">Автор появится во вкладке «Авторы» рабочей Google Таблицы и в отчёте сайта. Учётная запись для входа на сайт не создаётся.</p>
    <Field label="Округ" required><Select value={group} disabled={busy || me.role === 'coordinator'} onChange={e => setGroup(e.target.value)} options={[{ value: '', label: 'Выберите округ' }, ...data.groups.filter(g => me.role !== 'coordinator' || g.id === me.districtId).map(g => ({ value: g.id, label: g.num ? `${g.num} округ · ${g.name}` : g.name }))]} /></Field>
    <Field label="Фамилия и имя" required hint="Полное имя, как в профиле «Пиши-Делись». Например: Петров Иван."><Input maxLength={120} autoComplete="off" value={name} disabled={busy} onChange={e => setName(e.target.value)} /></Field>
    {DEMO_MODE ? <p className="muted small">В демонстрации добавление в рабочую таблицу выключено.</p> : loading ? <p className="muted small">Проверяем связь с таблицей…</p> : !ready && !error ? <p className="muted small">Связь с Google Таблицей ещё подключается.</p> : null}
    {error && <div className="callout danger" role="alert">{error}</div>}
  </Modal></>;
}
