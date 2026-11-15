import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaPdHandler, MEDIA_BRIDGE_URL, pdWeekLine, pdRecent } from '../.test-media/media-entry.js';
const header='Дата поста,Заголовок,Канал/группа,Источник,ФИО,Очки,URL,Критерии';
const row=(day,url)=>`${day},Публикация,Команда,vk,Иванов Иван,5,${url},Выполнены`;
function fixture(){
 let clock=Date.parse('2026-11-02T07:00:00Z'),fail=false,invalid=false;const calls=[];
 const handler=createMediaPdHandler(async url=>{
  calls.push(url);
  if(url!==MEDIA_BRIDGE_URL)throw new Error('Unexpected source request: '+url);
  return fail?new Response('Unavailable',{status:502}):Response.json(invalid?{error:'Missing sheet'}:{authors:'118 округ,1,,Иванов Иван',archive:header+'\n'+row('2026-09-30','https://vk.com/old'),season:header+'\n'+row('2026-09-30','https://vk.com/old')+'\n'+row('2026-10-31','https://vk.com/new')});
 },()=>clock);
 return {handler,calls,tick:ms=>clock+=ms,fail:()=>fail=true,invalid:()=>invalid=true};
}
const request=()=>new Request('https://example.invalid/media-pd');
test('the server and browser receive one September archive plus season 11, sharing a refresh for concurrent clients',async()=>{
 const f=fixture(),responses=await Promise.all([f.handler(request()),f.handler(request())]);
 for(const response of responses){assert.equal(response.status,200);const d=await response.json();assert.deepEqual(d.posts.map(p=>p[0]),['2026-09-30','2026-10-31']);assert.equal(d.seasons['2026-10'],11);assert.equal(d.sourceStatus,'ok');assert.equal(d.people[d.posts[1][4]][1],'118');}
 assert.equal(f.calls.length,1);assert.equal(f.calls.filter(url=>url===MEDIA_BRIDGE_URL).length,1);
 await f.handler(request());assert.equal(f.calls.length,1);
});
test('missing season 11 is an explicit source failure; a temporary cached response is marked stale and expires',async()=>{
 const f=fixture();await f.handler(request());f.tick(60001);f.fail();const cached=await f.handler(request());assert.equal(cached.status,200);assert.equal((await cached.json()).sourceStatus,'stale');assert.equal(cached.headers.get('cache-control'),'public, max-age=0');
 f.tick(900000);assert.equal((await f.handler(request())).status,502);
 const missing=fixture();missing.invalid();assert.equal((await missing.handler(request())).status,502);
});
test('the weekly digest reports real publication coverage without claiming the spreadsheet was not edited',()=>{
 const pd={people:[],posts:[['2026-10-31']],sourceStatus:'ok'};
 const text=pdWeekLine(pd,37,24,'2026-11-01');assert.match(text,/Посты «Пиши-Делись»: 37/);assert.match(text,/по 31\.10/);assert.doesNotMatch(text,/не обновлялась|30\.09/);
 assert.equal(pdRecent(pd,'2026-10-30'),true);assert.equal(pdRecent({...pd,sourceStatus:'stale'},'2026-10-30'),false);
 assert.match(pdWeekLine({...pd,sourceStatus:'stale'},37,24,'2026-11-01'),/не удалось обновить/);
 assert.match(pdWeekLine({people:[],posts:[]},0,0,'2026-11-01'),/пока нет публикаций/);
});
