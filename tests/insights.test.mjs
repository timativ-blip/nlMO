import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsTasks, dateInMoscow, median, periodTrend, processInsights, taskSnapshot } from '../.test-build/insights.js';

const today = '2026-10-30', from = '2026-10-01', to = '2026-10-31';
const task = (id, fields = {}) => ({ id, title: id, status: 'in_progress', due: today, createdAt: '2026-10-01T09:00:00Z', districtId: '118', assigneeId: 'member', coAssigneeIds: [], authorId: 'head', comments: [], history: [], ...fields });
const user = (id, role = 'member', districtId = '118') => ({ id, name: id, active: true, role, districtId });

test('calendar dates use Moscow, including the midnight boundary', () => {
  assert.equal(dateInMoscow('2026-10-30T22:30:00Z'), '2026-10-31');
  assert.equal(dateInMoscow('2026-10-30'), today);
  assert.equal(dateInMoscow('invalid'), null);
  assert.equal(dateInMoscow('2026-02-30'), null);
});

test('median is stable, ignores invalid values and does not mutate input', () => {
  const values = [9, 1, 4, 2];
  assert.equal(median(values), 3);
  assert.deepEqual(values, [9, 1, 4, 2]);
  assert.equal(median([NaN, Infinity]), null);
});

test('current overdue buckets do not overlap and exclude reviewed/completed/cancelled tasks', () => {
  const dates = ['2026-10-29','2026-10-27','2026-10-26','2026-10-23','2026-10-22','2026-10-16','2026-10-15'];
  const records = dates.map((due,i)=>task(String(i),{due}));
  records.push(task('review',{due:from,status:'review'}),task('done',{due:from,status:'done'}),task('cancelled',{due:from,status:'cancelled'}),task('due-today'));
  const a = processInsights(records, [], from, to, today);
  assert.equal(a.overdue.length,7);
  assert.deepEqual(a.aging.map((b)=>b.tasks.length),[2,2,2,1]);
  assert.equal(new Set(a.aging.flatMap((b)=>b.tasks.map((t)=>t.id))).size,7);
});

test('review queue handles missing dates without presenting them as zero-day waits', () => {
  const records = [task('a',{status:'review',result:{submittedDate:'2026-10-25'}}),task('b',{status:'review',result:{submittedDate:today}}),task('c',{status:'review'})];
  const a = processInsights(records, [], from, to, today);
  assert.equal(a.review.length,3);
  assert.deepEqual(a.waiting.map((r)=>r.days),[5,0]);
  assert.equal(a.reviewMedian,2.5);
});

test('cycle time and rework share use confirmations in the selected period', () => {
  const records = [
    task('same-day',{status:'done',createdAt:'2026-10-29T22:30:00Z',confirmedAt:today}),
    task('two-days',{status:'done',createdAt:'2026-10-28T01:00:00Z',confirmedAt:today,comments:[{kind:'return'}]}),
    task('old',{status:'done',confirmedAt:'2026-09-30'}),
    task('not-done',{result:{submittedDate:today}}),
  ];
  const a = processInsights(records, [], from, to, today);
  assert.equal(a.confirmed.length,2);
  assert.equal(a.cycleMedian,1);
  assert.equal(a.returnShare,.5);
  assert.equal(processInsights([],[],from,to,today).returnShare,null);
});

test('seven-day planning window includes today and co-assignees are counted once per person', () => {
  const records = [task('today',{coAssigneeIds:['member','other']}),task('last',{due:'2026-11-05'}),task('outside',{due:'2026-11-06'}),task('review',{status:'review'})];
  const a=processInsights(records,[user('member'),user('other')],from,to,today);
  assert.deepEqual(a.upcoming.map((d)=>d.tasks.length),[1,0,0,0,0,0,1]);
  assert.equal(a.workloads.find((r)=>r.user.id==='member').active.length,4);
  assert.equal(a.workloads.find((r)=>r.user.id==='other').active.length,1);
});

test('analysis respects role visibility even with the complete demo state', () => {
  const records=[task('own'),task('other',{assigneeId:'other',authorId:'other'}),task('other-district',{districtId:'119',assigneeId:'other',authorId:'other'}),task('coassigned',{districtId:'119',assigneeId:'other',coAssigneeIds:['member']})];
  const s={tasks:records};
  assert.deepEqual(analyticsTasks(s,user('member')).map((t)=>t.id),['own','coassigned']);
  assert.deepEqual(analyticsTasks(s,user('coordinator','coordinator')).map((t)=>t.id),['own','other']);
  assert.equal(analyticsTasks(s,user('head','head'), '119').length,2);
});

test('period bins retain boundary dates and snapshots exclude cancellations', () => {
  const records=[task('start',{due:from,status:'done',confirmedAt:from}),task('end',{due:to,status:'done',confirmedAt:to}),task('cancelled',{status:'cancelled'})];
  const trend=periodTrend(records,from,to);
  assert.equal(trend.length,5);
  assert.equal(trend.reduce((n,p)=>n+p.assigned,0),2);
  assert.equal(trend.reduce((n,p)=>n+p.confirmed,0),2);
  assert.equal(taskSnapshot(records,from,to).reduce((n,p)=>n+p.tasks.length,0),2);
});

test('heatmap has 12 Monday-to-Sunday columns and no future activity', () => {
  const a=processInsights([task('today',{status:'done',confirmedAt:today}),task('future',{status:'done',confirmedAt:'2026-11-01'})],[],from,to,today);
  assert.equal(a.heat.length,84);
  assert.equal(new Date(a.heat[0].day).getUTCDay(),1);
  assert.equal(new Date(a.heat[83].day).getUTCDay(),0);
  assert.equal(a.heat.find((d)=>d.day===today).tasks.length,1);
  assert.equal(a.heat.filter((d)=>d.future).reduce((n,d)=>n+d.tasks.length,0),0);
});
