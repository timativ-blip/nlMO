import type { District, User } from '../data/types';
import { DEMO_MODE } from '../data/store';
import type { useDistrictDirectory } from '../data/district-directory';
import { resolveCoordinator } from '../../supabase/functions/_shared/district-directory';

export function DistrictCoordinator({ district, registered, directory, detailed = false }: { district: District; registered?: User; directory: ReturnType<typeof useDistrictDirectory>; detailed?: boolean }) {
  const entry = directory.data?.districts.find(item => item.id === district.id);
  const result = resolveCoordinator(district.coordinatorName, registered?.name, entry);
  const description = result.source === 'profile' || DEMO_MODE ? ''
    : result.source === 'conflict' ? 'в таблице указаны разные координаторы'
    : directory.error ? 'сохранённые данные, таблица временно недоступна'
    : directory.loading ? 'проверяю таблицу…'
    : result.source === 'sheet' ? 'по актуальной таблице' : 'данные из карточки округа';
  return <span title={description || undefined}>
    {registered && detailed ? <a href={`#/team/people/${registered.id}`}>{result.name}</a> : result.name || (result.source === 'conflict' ? 'требует уточнения' : 'не назначен')}
    {detailed && description && <> <span className="muted">({description})</span></>}
  </span>;
}
