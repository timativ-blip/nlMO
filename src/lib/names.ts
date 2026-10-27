/** Ключ ФИО для сопоставления учётной записи с таблицей «Пиши-Делись»:
 *  фамилия + имя без учёта порядка, регистра и «ё». Тот же ключ — в функции digest. */
export const nameKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).sort().join(' ');
