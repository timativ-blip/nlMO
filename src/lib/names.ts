/** Ключ ФИО для сопоставления учётной записи с таблицей «Пиши-Делись»:
 *  фамилия + имя без учёта порядка, регистра и «ё». Тот же ключ — в функции digest. */
export const nameKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).sort().join(' ');

// Типичные окончания русских фамилий: так отличаем «Василевский Тимур» от «Тимур Василевский»
const SURNAME = /(ов|ев|ёв|ин|ын|ский|цкий|ской|цкой|ой|ая|ова|ева|ёва|ина|ына|ская|цкая|ко|ук|юк|чук|енко|ых|их|ман|ер|дзе|швили|ян)$/i;
/** Имя для обращения («Доброе утро, Тимур») при любом порядке «Фамилия Имя» / «Имя Фамилия» */
export function firstName(full: string) {
  const [a = '', b = ''] = full.trim().split(/\s+/);
  if (!b) return a;
  const aSur = SURNAME.test(a), bSur = SURNAME.test(b);
  return aSur && !bSur ? b : a;
}
