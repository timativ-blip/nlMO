import test from 'node:test';
import assert from 'node:assert/strict';
import { createDistrictDirectoryHandler, DISTRICT_SHEET_URL, parseDistrictDirectory, resolveCoordinator, isDistrictDirectory } from '../.test-media/media-entry.js';
const header = '№округа,Город,Координатор';
const source = name => `${header}\nМО,Область,Региональный координатор\n121,Красногорск,${name}\n,Истра,${name}\n122,Люберцы,\n,Раменское,`;
const request = () => new Request('https://example.invalid/media-groups?view=directory');

test('directory reads merged district numbers, excludes the regional row and uses current spreadsheet names', () => {
 const districts = parseDistrictDirectory(source('Петухов Тимофей'));
 assert.deepEqual(districts, [{ id:'121', coordinatorName:'Петухов Тимофей', conflict:false }, { id:'122', coordinatorName:null, conflict:false }]);
 assert.throws(() => parseDistrictDirectory('<html>Login</html>'), /колонок/);
 assert.throws(() => parseDistrictDirectory(header+'\nМО,Область,Имя'), /нет округов/);
});

test('conflicting names cannot silently select an old coordinator and a cleared source is not replaced by a saved name', () => {
 const [entry] = parseDistrictDirectory(header+'\n121,Красногорск,Петухов Тимофей\n,Истра,Блюдин Алексей');
 assert.equal(entry.conflict, true); assert.equal(entry.coordinatorName, null);
 assert.deepEqual(resolveCoordinator('Блюдин Алексей', undefined, entry), { name:null, source:'conflict' });
 assert.deepEqual(resolveCoordinator('Блюдин Алексей', undefined, {id:'121',coordinatorName:null,conflict:false}), { name:null,source:'sheet' });
 assert.deepEqual(resolveCoordinator('Блюдин Алексей', 'Назначенный пользователь', entry), {name:'Назначенный пользователь',source:'profile'});
});

test('lightweight endpoint refreshes an edited name within a minute without scanning social networks and shares simultaneous refreshes', async () => {
 let time = Date.parse('2026-11-02T13:40:00Z'), name = 'Блюдин Алексей'; const urls = [];
 const handler = createDistrictDirectoryHandler(async (url, options) => { urls.push(url); assert.equal(options.cache,'no-store'); return new Response(source(name)); }, () => time);
 const first = await Promise.all([handler(request()), handler(request())]);
 assert.equal(urls.length,1); assert.equal(urls[0],DISTRICT_SHEET_URL);
 for(const response of first) assert.equal((await response.json()).districts[0].coordinatorName,'Блюдин Алексей');
 name='Петухов Тимофей';time+=60001;
 const refreshed=await handler(request());const data=await refreshed.json();assert.equal(data.districts[0].coordinatorName,'Петухов Тимофей');assert.equal(data.sourceStatus,'ok');assert.equal(isDistrictDirectory(data),true);assert.equal(urls.length,2);
 assert.equal(isDistrictDirectory({...data,districts:[{id:'121',coordinatorName:42}]}),false);
});

test('a source failure is explicit, the limited cached directory is labelled stale, and old monitor payloads cannot pass validation', async () => {
 let time=Date.parse('2026-11-02T13:40:00Z'), fail=false;
 const handler=createDistrictDirectoryHandler(async()=>fail?new Response('Down',{status:502}):new Response(source('Петухов Тимофей')),()=>time);
 await handler(request());fail=true;time+=60001;
 const cached=await handler(request());assert.equal((await cached.json()).sourceStatus,'stale');assert.equal(cached.headers.get('cache-control'),'no-store');
 time+=900000;assert.equal((await handler(request())).status,502);
 assert.equal(isDistrictDirectory({groups:[],updated:new Date(time).toISOString(),vkEnabled:false}),false);
 assert.deepEqual(resolveCoordinator('Петухов Тимофей',undefined),{name:'Петухов Тимофей',source:'saved'});
});
