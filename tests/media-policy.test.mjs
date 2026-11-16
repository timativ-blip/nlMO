import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationAssessment, silentGroupCount, districtPublicationReminders } from '../.test-media/media-entry.js';
const now=Date.parse('2026-11-16T09:00:00Z'),ago=days=>({status:'ok',last:new Date(now-days*86400000).toISOString()});
const profile={id:'coord',role:'coordinator',districtId:'121',active:true};
test('Telegram posting gaps cannot worsen district assessment, while VK gaps still count',()=>{
 for(const tg of [null,ago(0),ago(2),ago(60),{status:'empty'},{status:'closed'},{status:'error'}]){
  assert.equal(silentGroupCount([{vk:ago(0),tg}],now),0);
  assert.equal(silentGroupCount([{vk:ago(5),tg}],now),1);
  assert.equal(silentGroupCount([{vk:null,tg}],now),null);
  assert.equal(publicationAssessment(tg,'tg',now).cls,'none');
 }
 assert.equal(publicationAssessment(ago(60),'tg',now).days,60);
});
test('unknown VK monitoring never creates a missing-post penalty or a false healthy signal',()=>{
 for(const vk of [null,{status:'nokey'},{status:'error'},{status:'closed'},{status:'ok',last:'invalid'},ago(-1)])assert.equal(silentGroupCount([{vk,tg:ago(60)}],now),null);
 assert.equal(silentGroupCount([{vk:{status:'empty'},tg:null}],now),1);
 assert.equal(publicationAssessment({status:'ok',last:'2026-11-15T22:00:00Z'},'vk',Date.parse('2026-11-16T21:10:00Z')).days,1);
});
test('Telegram silence produces no reminder; mixed channels mention only the assessed VK channel',()=>{
 const monitor=vk=>({updated:new Date(now).toISOString(),groups:[{okrug:'121',city:'Красногорск',vk,tg:ago(60)}]});
 assert.deepEqual(districtPublicationReminders(monitor(ago(0)),[profile],now),[]);
 assert.deepEqual(districtPublicationReminders(monitor(null),[profile],now),[]);
 const reminders=districtPublicationReminders(monitor(ago(5)),[profile],now);
 assert.equal(reminders.length,1);assert.match(reminders[0].text,/ВК: 5 дн/);assert.doesNotMatch(reminders[0].text,/Telegram/);
});
