import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeason, buildTimeline, loadMediaTimeline, mediaMonth, mediaMonths, mediaSeasonTitle, parseCsv, SEASON_11_URL } from '../.test-media/media-season.js';

const headers = ['Дата поста','Заголовок','Канал/группа','Источник','ID аккаунта','ФИО','Критерии','Невыполненные критерии','Очки','Вклад в регион','Просмотры','Лайки','Комментарии','Репосты','В избранное','URL'];
const csv = (...records) => [headers,...records.map((record)=>headers.map((name)=>record[name] ?? ''))]
  .map((row)=>row.map((cell)=>`"${String(cell).replaceAll('"','""')}"`).join(',')).join('\r\n');
const row = (fields={}) => ({ 'Дата поста':'2026-10-02','Заголовок':'Встреча с жителями','Канал/группа':'Команда','Источник':'vk','ФИО':'Иванов Иван','Критерии':'Выполнены','Очки':'12,5','Вклад в регион':'0,2','Просмотры':'200','URL':'https://vk.com/post-1',...fields });
const post = (day, url, person=0, points=4) => [day,'Архив','Канал','vk',person,points,0,50,1,0,0,0,url,1,''];
const archive = () => ({ groups:[{id:'118',num:118,name:'Балашихинский'},{id:'119',num:119,name:'Дмитровский'}],people:[['Иванов Иван','118'],['Петров Пётр','119']],posts:[post('2026-09-10','https://vk.com/known')],updated:'2026-10-01T00:00:00Z' });

test('Google CSV retains quoted commas, escaped quotes and multiline titles',()=>{
  const title='Итоги, "Новые люди"\nВстреча с жителями';
  const data=buildSeason('\uFEFF'+csv(row({'Заголовок':title})),archive());
  assert.equal(data.posts[0][1],title);
  assert.deepEqual(parseCsv('a,b\r\n"c,d","e""f"\r\n'),[['a','b'],['c,d','e"f']]);
});

test('September stays byte-for-byte in season 10; October comes only from season 11',()=>{
  const old=archive();
  old.posts.push(post('2026-10-01','https://vk.com/old-october',0,999));
  const before=JSON.stringify(old);
  const season=buildSeason(csv(row({'Дата поста':'2026-09-10','URL':'https://vk.com/known','Очки':'888'}),row(),row()),old);
  const data=buildTimeline(old,season);
  assert.equal(data.posts.length,2);
  assert.deepEqual(data.posts[0],old.posts[0]);
  assert.equal(data.posts[1][5],12.5);
  assert.equal(data.posts.some((p)=>p[12].includes('old-october')),false);
  assert.equal(JSON.stringify(old),before);
});

test('known post aliases keep the author and district when the new sheet abbreviates a name',()=>{
  const old=archive();
  const season=buildSeason(csv(row({'ФИО':'Псевдоним И.','Дата поста':'2026-09-10','URL':'https://vk.com/known'}),row({'ФИО':'Псевдоним И.'})),old);
  assert.equal(season.posts[1][4],0);
  assert.deepEqual(season.people[season.posts[1][4]],['Иванов Иван','118']);
});

test('new authors remain outside a district and repeated posts use the same person',()=>{
  const data=buildSeason(csv(row({'ФИО':'Новый Автор'}),row({'ФИО':'Новый Автор','URL':'https://vk.com/post-2'})),archive());
  assert.equal(data.people.length,3);
  assert.deepEqual(data.people[2],['Новый Автор','none']);
  assert.deepEqual(data.posts.map((p)=>p[4]),[2,2]);
});

test('an ambiguous initial cannot assign a new post to an arbitrary district',()=>{
  const old=archive();old.people.push(['Иванов Илья','119']);
  const data=buildSeason(csv(row({'ФИО':'Иванов И.'})),old);
  assert.equal(data.people[data.posts[0][4]][1],'none');
});

test('Russian numbers, unmet criteria and post details retain their values',()=>{
  const data=buildSeason(csv(row({'Дата поста':'2.10.2026','Очки':'1\u00a0234,5','Просмотры':'2 500','Критерии':'Не выполнены','Невыполненные критерии':'Меньше 50 просмотров','Источник':' TG '})),archive());
  const p=data.posts[0];
  assert.equal(p[0],'2026-10-02');assert.equal(p[3],'tg');assert.equal(p[5],1234.5);assert.equal(p[7],2500);assert.equal(p[13],0);assert.equal(p[14],'Меньше 50 просмотров');
});

test('bad dates and missing authors are skipped and a missing sheet cannot masquerade as zero points',()=>{
  const data=buildSeason(csv(row({'Дата поста':'2026-02-30'}),row({'ФИО':'','URL':'https://vk.com/empty'})),archive());
  assert.deepEqual(data.posts,[]);
  assert.throws(()=>buildSeason('<html>Вход в Google</html>',archive()),/нет колонки/);
});

test('the initial month is October and arrows go September season 10 ↔ October season 11',()=>{
  const data=buildTimeline(archive(),buildSeason(csv(row()),archive()));
  const months=mediaMonths(data);
  assert.deepEqual(months,['2026-09','2026-10']);
  const initial=mediaMonth(months,'');
  assert.equal(initial,'2026-10');
  assert.equal(mediaSeasonTitle(data,initial),'11 сезон · Октябрь 2026');
  const previous=months[months.indexOf(initial)-1];
  assert.equal(mediaSeasonTitle(data,previous),'10 сезон · Сентябрь 2026');
  assert.equal(months[months.indexOf(previous)+1],initial);
  assert.equal(mediaMonth(months,previous),previous);
});

test('an empty October is still selectable and the archive retains older months',()=>{
  const old=archive();old.posts.unshift(post('2026-08-31','https://vk.com/august'));
  const data=buildTimeline(old,buildSeason(csv(),old));
  assert.deepEqual(mediaMonths(data),['2026-08','2026-09','2026-10']);
  assert.equal(mediaMonth(mediaMonths(data),''),'2026-10');
  assert.equal(mediaSeasonTitle(data,'2026-08'),'Август 2026');
});

test('the live loader reads both sources, omits Google credentials and propagates cancellation',async()=>{
  const original=globalThis.fetch, calls=[];
  const signal=new AbortController().signal;
  try {
    globalThis.fetch=async(url,options)=>{
      calls.push({url,options});
      return url===SEASON_11_URL ? new Response(csv(row())) : Response.json(archive());
    };
    const data=await loadMediaTimeline('https://example.com/media-pd',signal);
    assert.equal(data.posts.length,2);
    assert.equal(data.posts.filter((p)=>p[0].startsWith('2026-10')).length,1);
    assert.equal(calls.find((c)=>c.url===SEASON_11_URL).options.credentials,'omit');
    assert.ok(calls.every((c)=>c.options.signal===signal && c.options.cache==='no-store'));
    globalThis.fetch=async()=>new Response('Unavailable',{status:502});
    await assert.rejects(loadMediaTimeline('https://example.com/media-pd',signal),/Не удалось обновить/);
  } finally {globalThis.fetch=original;}
});
