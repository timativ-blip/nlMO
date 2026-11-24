import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorRoster, buildSeason, buildTimeline, buildMediaReport, mediaReportText, mediaReportCsv, mediaReportSvg, surnameFirst, firstName } from '../.test-media/media-entry.js';
const csv = rows => rows.map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
const roster = () => buildAuthorRoster(csv([
 ['118 округ @coord',3,'','Иванов Иван','Не добавлять из заметок'],['','','','Петров Пётр'],['','','','Иванов Иван'],
 ['119 округ',1,'','Попов Иван'],['120 округ',1,'','Попов Иван'],['Штаб',1,'','Анна Штабная']
]));
const headers = ['Дата поста','ФИО','Источник','Очки','URL','Критерии'];
const season = rows => buildTimeline(roster(), buildSeason(csv([headers,...rows]),roster()));
test('surname-first display retains spelling, initials and patronymics without changing unknown labels',()=>{
 for(const [from,to] of [['Вадим Корнюхин','Корнюхин Вадим'],['Владимир Бейтман','Бейтман Владимир'],['Юлия Емелева','Емелева Юлия'],['Марина Першина','Першина Марина'],['Эльдар Галлямов','Галлямов Эльдар'],['И. Антропова','Антропова И.'],['Антропова И.','Антропова И.'],['Иван Петрович Сидоров','Сидоров Иван Петрович'],['Иван Сидоров Петрович','Сидоров Иван Петрович'],['Степайнес Жанна Романовна','Степайнес Жанна Романовна'],['- М.','- М.']]){
   assert.equal(surnameFirst(from),to);assert.equal(surnameFirst(to),to);
 }
 assert.equal(firstName('Першина Марина'),'Марина');assert.equal(firstName('Василевский Тимур'),'Тимур');
});
test('display names preserve district blocks, source order, author indices and publication counts in every export',()=>{
 const source={groups:[{id:'119',num:119,name:'Дмитровский'},{id:'128',num:128,name:'Серпуховский'}],people:[['Вадим Корнюхин','119'],['Антропова Ирина','119'],['Юлия Емелева','119'],['Владимир Бейтман','128']],posts:[['2026-11-01','','','vk',2,1,0,0,0,0,0,0,'https://test/same-person',1,'']],updated:'2026-11-24'};
 const before=JSON.stringify(source),r=buildMediaReport(source,'2026-11-24');
 assert.deepEqual(r.rows.map(g=>g.id),['119','128']);
 assert.deepEqual(r.rows[0].authors.map(a=>[a.index,a.name,a.posts]),[[0,'Корнюхин Вадим',0],[1,'Антропова Ирина',0],[2,'Емелева Юлия',1]]);
 assert.equal(r.rows[1].authors[0].name,'Бейтман Владимир');assert.equal(r.all.posts,1);assert.equal(r.all.writing,1);assert.equal(JSON.stringify(source),before);
 assert.match(mediaReportText(r),/Корнюхин Вадим/);assert.match(mediaReportCsv(r),/Емелева Юлия/);
});
test('authors tab supplies membership once per district, contact and declared count independently',()=>{
 const d=roster(); assert.equal(d.people.length,5); assert.equal(d.roster.members.length,5); assert.equal(d.roster.declared['118'],3); assert.equal(d.roster.contacts['118'],'@coord'); assert.equal(d.people.some(p=>p[0].includes('заметок')),false);
 assert.throws(()=>buildAuthorRoster('<html>Login</html>'),/Авторы/);
});
test('duplicate full names and wrong full first names never assign an arbitrary district',()=>{
 const d=season([['2026-10-02','Попов Иван','vk',2,'https://test/1','Выполнены'],['2026-10-03','Иванов Илья','vk',2,'https://test/2','Выполнены']]);
 assert.deepEqual(d.posts.map(p=>d.people[p[4]][1]),['none','none']);
});
test('season 11 includes Dec 20 and excludes Sep 30, Dec 21 and next year',()=>{
 const dates=['2026-09-30','2026-10-01','2026-12-20','2026-12-21','2027-01-01'];
 const d=season(dates.map((date,i)=>[date,'Иванов И.','vk',2,'https://test/'+i,'Выполнены']));
 assert.deepEqual(d.posts.map(p=>p[0]),['2026-10-01','2026-12-20']);
});
test('report separates registered/ranked/writing and uses cumulative publication cutoffs for weekly deltas',()=>{
 const d=season([
 ['2026-10-01','Иванов И.','vk',2,'https://test/1','Выполнены'],
 ['2026-11-09','Петров П.','tg',2,'https://test/2','Без критериев'],
 ['2026-11-15','Иванов И.','vk',2,'https://test/3','Нет в источнике'],
 ['2026-11-16','Иванов И.','vk',2,'https://test/4','Выполнены'],
 ['2026-11-12','Неизвестный А.','vk',2,'https://test/5','Выполнены'],
 ['2026-11-02','Штабная А.','vk',2,'https://test/6','Выполнены'],
 ]);
 const r=buildMediaReport(d,'2026-11-15'),g=r.rows[0];
 assert.equal(r.compareTo,'2026-11-08'); assert.deepEqual([g.registered,g.ranked,g.writing,g.posts,g.counted,g.writingDelta,g.postsDelta],[2,1,2,3,1,1,2]);
 assert.equal(r.outside.posts,1);assert.equal(r.total.posts+r.outside.posts,r.all.posts);assert.equal(r.all.posts,5);
 assert.deepEqual([r.all.writing,r.all.ranked],[4,3]);
 // Accepting a previously rejected post changes rating, but not whether its author writes.
 const peter=g.authors.find(a=>a.name==='Петров Пётр').index;
 const accepted={...d,posts:d.posts.map(p=>p[4]===peter ? Object.assign([...p],{13:1}) : p)};
 const after=buildMediaReport(accepted,'2026-11-15');
 assert.equal(after.all.writing,r.all.writing);assert.equal(after.all.ranked,r.all.ranked+1);
 assert.match(mediaReportText(r),/🟢 Петров Пётр — 1 пост, 0 зачтено/);assert.match(mediaReportText(r),/🔴 Попов Иван — 0/);
 assert.match(mediaReportCsv(r),/Изменение постов/);assert.match(mediaReportSvg(r),/Количество постов/);
 assert.throws(()=>buildMediaReport(d,'2026-11-15','2026-11-15'),/раньше/);
});
test('an empty season and baseline before Oct 1 retain roster and produce zero, not negative deltas',()=>{
 const r=buildMediaReport(season([]),'2026-10-02');assert.equal(r.all.registered,5);assert.equal(r.all.postsDelta,0);assert.equal(r.all.writingDelta,0);assert.equal(r.compareTo,'2026-09-25');
});


test('explicit authors-sheet aliases merge profile FIO into the named roster person only for listed channels',()=>{
 const roster=buildAuthorRoster(csv([['128 округ',1,'','Першина Марина','Маркова О.','Марина Першина\nМарина Першина | По делу']]));
 const cols=['Дата поста','ФИО','Источник','Очки','URL','Критерии','Канал/группа'];
 const d=buildTimeline(roster,buildSeason(csv([cols,
 ['2026-11-01','Маркова О.','vk',1,'https://test/m1','Выполнены','Марина Першина'],
 ['2026-11-02','Маркова О.','tg',1,'https://test/m2','Без критериев','Марина Першина | По делу'],
 ['2026-11-03','Маркова О.','vk',1,'https://test/m3','Выполнены','Чужой канал'],
 ]),roster));
 assert.deepEqual(d.posts.map(p=>d.people[p[4]][0]),['Першина Марина','Першина Марина','Маркова О.']);
 const r=buildMediaReport(d,'2026-11-15');assert.equal(r.rows[0].posts,2);assert.equal(r.rows[0].ranked,1);assert.equal(r.rows[0].registered,1);assert.equal(r.outside.posts,1);
});
test('an alias used by two roster members remains unassigned',()=>{
 const r=buildAuthorRoster(csv([['118 округ',1,'','Иванов Иван','Псевдоним И.'],['119 округ',1,'','Иванов Илья','Псевдоним И.']]));
 const d=buildSeason(csv([headers,['2026-11-01','Псевдоним И.','vk',1,'https://test/ambiguous','Выполнены']]),r);
 assert.equal(d.people[d.posts[0][4]][1],'none');
});

test('archive URL aliases cannot bypass an explicit channel restriction',()=>{
 const roster=buildAuthorRoster(csv([['128 округ',1,'','Першина Марина','Маркова О.','Марина Першина']]));
 const cols=['Дата поста','ФИО','Источник','Очки','URL','Критерии','Канал/группа'];
 const known=buildSeason(csv([cols,['2026-09-30','Маркова О.','vk',1,'https://test/known','Выполнены','Марина Першина']]),roster);
 const d=buildSeason(csv([cols,['2026-09-30','Маркова О.','vk',1,'https://test/known','Выполнены','Марина Першина'],['2026-11-01','Маркова О.','vk',1,'https://test/new','Выполнены','Другой человек']]),known);
 assert.equal(d.people[d.posts[1][4]][1],'none');
});
