import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { isOnTime, num, pct, type MetricFact } from '../data/calc';
import { canSeeDaily } from '../data/perm';
import type { DailyReport, Task, User } from '../data/types';
import type { PdData, Post } from '../data/media-types';
import { fmtDate } from '../lib/date';
import { openRecords, type RecordsSpec, type RecordSection, type SourceRecord } from './global';

export function MetricValue({ children, records, className = '', label }: {
  children: ReactNode; records: RecordsSpec | (() => RecordsSpec); className?: string; label?: string;
}) {
  return <button type="button" className={`metric-value ${className}`} onClick={event => {
    event.stopPropagation();
    openRecords(typeof records === 'function' ? records() : records);
  }} title="Открыть исходные записи" aria-label={label ?? undefined}>{children}<ArrowUpRight size={12} aria-hidden /></button>;
}

export function planSections(facts: MetricFact[]): RecordSection[] {
  return facts.map(fact => ({
    title: `${fact.metric.name} · ${num(fact.fact)} / ${num(fact.plan)} ${fact.metric.unit} · ${pct(fact.pct)}`,
    items: [{
      id: fact.metric.id, title: 'План показателя за период', detail: `Вес: ${fact.metric.weight}`,
      value: num(fact.plan), href: '/analytics/metrics',
    }],
    tasks: fact.records,
    cellValue: task => num(task.result?.value ?? 0),
  }));
}

export function planRecords(title: string, facts: MetricFact[]): RecordsSpec {
  return { title, rule: 'Взвешенное среднее выполнения планов по показателям. Вклад каждого показателя ограничен 120%. Факт — сумма значений подтверждённых задач.', sections: planSections(facts) };
}

export function taskShare(title: string, tasks: Task[], counted: Task[], rule: string): RecordsSpec {
  const ids = new Set(counted.map(task => task.id));
  return {
    title, rule: `${rule} Учтено ${counted.length} из ${tasks.length}.`,
    sections:[
      { title: 'В числителе', tasks: counted },
      { title: 'Остальные записи знаменателя', tasks: tasks.filter(task => !ids.has(task.id)) },
    ],
  };
}

export function timelinessRecords(title: string, confirmed: Task[]): RecordsSpec {
  return taskShare(title, confirmed, confirmed.filter(isOnTime), 'Результат сдан в срок или раньше. Среди задач, учтённых в расчёте.');
}

export function dailyRecord(report: DailyReport, author?: User): SourceRecord {
  return {
    id: report.id, title: author?.name ?? 'Отчёт дня', detail: fmtDate(report.day),
    value: 'Сдан', href: '/daily/' + encodeURIComponent(report.id),
  };
}

export function dailyCoverage(viewer: User, people: User[], days: string[], reports: DailyReport[]): RecordsSpec {
  const visible = people.filter(person => canSeeDaily(viewer, person));
  const byDay = new Map(reports.map(report => [`${report.userId}|${report.day}`, report]));
  const entries = visible.flatMap(person => days.map(day => {
    const report = byDay.get(`${person.id}|${day}`);
    return report ? dailyRecord(report, person) : {
      id: `${person.id}|${day}`, title: person.name, detail: fmtDate(day), value: 'Не сдан',
    };
  }));
  return {
    title: 'Отчётность за выбранные дни', rule: 'Каждая строка — сотрудник и день, вошедшие в расчёт. Сданы только сохранённые отчёты.',
    sections: [{title: 'Сдано', items: entries.filter(entry => entry.value === 'Сдан')},
      {title: 'Не сдано', items: entries.filter(entry => entry.value === 'Не сдан')}],
  };
}

function safeLink(value: string | undefined) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}

export function publicationRecords(title: string, data: PdData, posts: Post[], value?: (post: Post) => string): RecordsSpec {
  return {title, rule:'Публикации из той же выгрузки и того же периода, что и показатель.',items:posts.map((post,index)=>({
    id:String(index), title:post[1] || post[2] || 'Публикация', detail:`${data.people[post[4]]?.[0] ?? 'Автор'} · ${fmtDate(post[0])}`,
    value:value?.(post), externalHref:safeLink(post[12]),
  }))};
}
