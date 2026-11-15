import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {validateAuthor,createMediaAuthorsHandler} from '../.test-media/media-entry.js';
const actor={role:'coordinator',districtId:'118',active:true};
test('server enforces current district, active approval and valid full names',()=>{
 assert.deepEqual(validateAuthor(actor,{groupId:'118',name:'  Петров   Пётр  '}),{groupId:'118',name:'Петров Пётр'});
 for(const value of [{groupId:'119',name:'Петров Пётр'},{groupId:'hq',name:'Петров Пётр'},{groupId:'118',name:'=IMPORTDATA(test)'},{groupId:'118',name:'Петров'}])assert.throws(()=>validateAuthor(actor,value));
 for(const profile of [{...actor,active:false},{...actor,pending:true},{...actor,role:'member'}])assert.throws(()=>validateAuthor(profile,{groupId:'118',name:'Петров Пётр'}));
 assert.equal(validateAuthor({...actor,role:'staff'},{groupId:'119',name:'Петров Пётр'}).groupId,'119');
});
test('writer never calls Google for anonymous, wrong-district or unapproved requests; unknown saves are not retried',async()=>{
 let calls=0;
 const handler=createMediaAuthorsHandler({authorize:async token=>token==='valid'?actor:null,apiKey:'public',bridgeUrl:'https://script.google.com/exec',fetcher:async()=>{calls++;throw new Error('network');}});
 const req=(body,token='valid')=>new Request('https://site/media-authors',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await handler(req({action:'add',groupId:'118',name:'Петров Пётр'},'bad'))).status,401);
 assert.equal((await handler(req({action:'add',groupId:'119',name:'Петров Пётр'}))).status,403);assert.equal(calls,0);
 assert.equal((await handler(req({action:'add',groupId:'118',name:'Петров Пётр'}))).status,502);assert.equal(calls,1);
});
function bridge(profile=actor){
 const rows=[['118 округ',1,'','Иванов Иван'],['119 округ',1,'','Петров Пётр'],['Штаб',1,'','Штабный Сотрудник']];let writes=0;
 const sheet={getDataRange:()=>({getValues:()=>rows.map(r=>r.slice())}),insertRowBefore:n=>{rows.splice(n-1,0,['','','','']);writes++;},getRange:(r,c)=>({setValue:value=>{rows[r-1][c-1]=value;writes++;}})};
 const context=vm.createContext({ContentService:{createTextOutput:text=>({setMimeType:()=>JSON.parse(text)}),MimeType:{JSON:'json'}},UrlFetchApp:{fetch:url=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(url.includes('/auth/')?{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}:[{data:profile}])})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush:()=>{}},Utilities:{},Error});
 vm.runInContext(readFileSync('docs/media-authors-bridge.gs','utf8'),context);
 const post=(groupId,name)=>context.doPost({postData:{contents:JSON.stringify({token:'x'.repeat(50),apiKey:'public',groupId,name})}});
 return {rows,post,writes:()=>writes};
}
test('Google bridge rechecks roles independently, inserts inside the right block and avoids duplicate retry',()=>{
 const b=bridge(); assert.equal(b.post('119','Новый Автор').ok,undefined);assert.equal(b.writes(),0);
 assert.equal(b.post('118','Новый Автор').ok,true);assert.equal(b.rows[0][1],2);assert.equal(b.rows[1][3],'Новый Автор');assert.equal(b.rows[2][0],'119 округ');assert.equal(b.rows[2][3],'Петров Пётр');
 const count=b.writes();assert.equal(b.post('118','Новый Автор').exists,true);assert.equal(b.writes(),count);
 assert.equal(bridge({...actor,pending:true}).post('118','Новый Автор').ok,undefined);
});
