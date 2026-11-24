/** Ключ ФИО для сопоставления учётной записи с таблицей «Пиши-Делись»:
 *  фамилия + имя без учёта порядка, регистра и «ё». Тот же ключ — в функции digest. */
export const nameKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).sort().join(' ');

// Типичные окончания русских фамилий: так отличаем «Василевский Тимур» от «Тимур Василевский»
const SURNAME = /(ов|ев|ёв|ин|ын|ский|цкий|ской|цкой|ой|ая|ова|ева|ёва|ина|ына|ская|цкая|ко|ук|юк|чук|енко|ых|их|ман|ер|дзе|швили|ян)$/i;
const GIVEN_NAMES = new Set(('Александр Александра Алексей Алёна Алена Алина Алла Анатолий Андрей Анна Антон Антонина Арсений Артём Артем Артур Арина Азиз Борис Вадим Валентина Валерий Василий Вера Вероника Виктор Виктория Владимир Владислав Вячеслав Галина Геннадий Глеб Григорий Даниил Данила Дарья Денис Диана Дмитрий Ева Евгений Евгения Егор Екатерина Елена Елизавета Жанна Захар Иван Игорь Илья Инна Ирина Камиль Карен Карина Кирилл Константин Ксения Лев Лиана Людмила Максим Марианна Марина Мария Матвей Михаил Надежда Наталья Наталия Никита Николай Оксана Олег Ольга Павел Полина Пётр Петр Роман Самир Семён Семен Сергей Светлана София Софья Станислав Степан Татьяна Тимофей Тимур Шухрат Эльдар Юлия Юрий Ярослав').toLowerCase().replace(/ё/g,'е').split(' '));
const givenName = (name: string) => GIVEN_NAMES.has(name.toLowerCase().replace(/ё/g, 'е'));
const patronymic = (name: string) => /(?:ович|евич|ич|овна|евна|ична)$/i.test(name);

/** Presentation only: source names and IDs stay intact for matching and writes. */
export function surnameFirst(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts.join(' ');
  const [a, b] = parts;
  if (parts.length === 3 && patronymic(b) && !patronymic(parts[2])) return [parts[2], a, b].join(' ');
  if (parts.length === 3 && givenName(a) && givenName(b) && SURNAME.test(parts[2])) return [parts[2], a, b].join(' ');
  const initial = /^[А-ЯЁA-Z]\.?$/i.test(a);
  if (!patronymic(b) && (givenName(a) && !givenName(b) || initial && SURNAME.test(b) || !SURNAME.test(a) && SURNAME.test(b) && !givenName(b))) return [b, a, ...parts.slice(2)].join(' ');
  return parts.join(' ');
}
/** Имя для обращения («Доброе утро, Тимур») при любом порядке «Фамилия Имя» / «Имя Фамилия» */
export function firstName(full: string) {
  const [a = '', b = ''] = full.trim().split(/\s+/);
  if (!b) return a;
  if (givenName(a)) return a;
  if (givenName(b)) return b;
  const aSur = SURNAME.test(a), bSur = SURNAME.test(b);
  return aSur && !bSur ? b : a;
}
