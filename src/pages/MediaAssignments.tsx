import { useState } from 'react';
import { Info } from 'lucide-react';
import { saveMediaMatch, useAppState, useWorkflowStatus } from '../data/store';
import { canAssignIn, isManager } from '../data/perm';
import { mediaSourceKey } from '../data/media-matches';
import { useMe } from '../ui/hooks';
import { Button, Empty, Field, Modal, Select, toast } from '../ui/kit';

export function MediaMatchForm({ sourceName, onSaved }: { sourceName: string; onSaved?: (group: string) => void }) {
  const s = useAppState(),
    me = useMe(),
    status = useWorkflowStatus();
  const existing = s.mediaMatches?.find((m) => m.id === mediaSourceKey(sourceName));
  const [group, setGroup] = useState(existing?.groupId ?? (me.role === 'coordinator' ? (me.districtId ?? '') : ''));
  const [userId, setUser] = useState(existing?.userId ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (me.role === 'member') return null;
  const groups = s.districts.filter((d) => canAssignIn(me, d.id));
  const people = s.users.filter(
    (u) =>
      u.active && !u.pending && (!group || (u.districtId ?? 'hq') === group) && (isManager(me) || u.districtId === me.districtId),
  );
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await saveMediaMatch(sourceName, group, userId || null);
      toast('Автор сопоставлен, рейтинг пересчитан');
      onSaved?.(group);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card card-pad col" style={{ gap: 12, marginTop: 16 }}>
      <h2>Привязать автора</h2>
      <p className="small muted">
        {sourceName}. Выберите человека из команды или только округ. Посты и баллы сохранятся; исходный документ не изменится.
      </p>
      {error && (
        <div className="callout danger" role="alert">
          {error}
        </div>
      )}
      <Field label="Округ" required>
        <Select
          value={group}
          onChange={(e) => {
            setGroup(e.target.value);
            setUser('');
          }}
          options={[
            { value: '', label: 'Выберите округ' },
            ...groups.map((d) => ({ value: d.id, label: d.name })),
            ...(isManager(me) ? [{ value: 'hq', label: 'Штаб' }] : []),
          ]}
        />
      </Field>
      <Field label="Человек из команды" hint="Необязательно, если нужно только распределить баллы по округу">
        <Select
          value={userId}
          onChange={(e) => {
            setUser(e.target.value);
            const person = s.users.find((u) => u.id === e.target.value);
            if (person) setGroup(person.districtId ?? 'hq');
          }}
          options={[
            { value: '', label: 'Только округ, без учётной записи' },
            ...people.map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
      </Field>
      {!status.ready && <p className="small muted">{status.loading ? 'Подключаю сопоставления…' : status.error}</p>}
      <Button variant="primary" disabled={busy || !status.ready || !group} onClick={save}>
        {busy ? 'Сохраняю…' : 'Сохранить сопоставление'}
      </Button>
    </div>
  );
}

export function MediaAssignments() {
  const s = useAppState(),
    me = useMe(),
    status = useWorkflowStatus();
  const [open, setOpen] = useState(false),
    [edit, setEdit] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const matches = (s.mediaMatches ?? []).filter((m) => m.active);
  const remove = async (id: string) => {
    const match = matches.find((m) => m.id === id)!;
    setBusy(true);
    try {
      await saveMediaMatch(match.sourceName, match.groupId, match.userId, false);
      toast('Сопоставление отменено, исходные данные восстановлены');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Сопоставления · {matches.length}
      </Button>
      {open && (
        <Modal
          open
          onClose={() => {
            setOpen(false);
            setEdit(null);
          }}
          title="Сопоставления авторов медиа"
          width={650}
        >
          <div className="col" style={{ gap: 12 }}>
            <p className="small muted">
              Привязки из исходного документа имеют приоритет. Эти сопоставления применяются к авторам без округа во всех сезонах
              и разделах сайта.
            </p>
            {!matches.length && (
              <Empty
                icon={Info}
                title="Сопоставлений пока нет"
                text="Откройте автора во вкладке «Без округа» и выберите округ."
              />
            )}
            {matches.map((match) => {
              const canEdit = isManager(me) || canAssignIn(me, match.groupId);
              return (
                <div className="card card-pad col" key={match.id}>
                  <b>{match.sourceName}</b>
                  <span className="small muted">
                    {s.districts.find((d) => d.id === match.groupId)?.name ?? 'Штаб'}
                    {match.userId ? ` · ${s.users.find((u) => u.id === match.userId)?.name ?? ''}` : ''}
                  </span>
                  {canEdit && (
                    <div className="row wrap">
                      <Button
                        size="sm"
                        disabled={busy || !status.ready}
                        onClick={() => setEdit(edit === match.id ? null : match.id)}
                      >
                        Изменить
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy || !status.ready} onClick={() => remove(match.id)}>
                        Отменить привязку
                      </Button>
                    </div>
                  )}
                  {edit === match.id && (
                    <MediaMatchForm key={match.id} sourceName={match.sourceName} onSaved={() => setEdit(null)} />
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
