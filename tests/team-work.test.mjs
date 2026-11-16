import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {randomUUID} from 'node:crypto';
import {qualityInsights,enqueueReport,reportOperations,claimReport,settleReport,flushReportQueue,resolveReportConflict,reportOwner,saveOfflineSnapshot,readOfflineSnapshot,clearSavedDraft} from '../.test-team/team-work-entry.js';
const task=(id,extra={})=>({id,assigneeId:'a',status:'done',confirmedAt:'2026-11-16',comments:[],...extra});
const ret=(id,at,reason='accuracy')=>({id,at,kind:'return',text:'Исправьте результат',authorId:'b',reworkReason:reason});
const input=(extra={})=>({kind:'daily',userId:'a',day:'2026-11-16',intent:'save',baseRevision:null,fields:{done:'Сегодня провели встречи',plan:'План',problems:''},...extra});
const owner=()=>reportOwner('test',randomUUID());
test('quality uses confirmation cohort, true return events, previous-period repeats and explicit reasons',()=>{
 const q=qualityInsights([task('first'),task('repeat',{comments:[ret('r1','2026-11-14T08:00Z'),ret('r2','2026-11-15T21:30Z')]}),task('legacy',{returnedAt:'2026-11-16T08:00Z'}),task('cancel',{status:'cancelled',comments:[ret('x','2026-11-16T08:00Z')]}),task('future',{confirmedAt:'2026-11-17'})],'2026-11-16','2026-11-16');
 assert.equal(q.confirmed.length,3);assert.equal(q.firstPass.length,1);assert.equal(q.events.length,2);assert.equal(q.repeated.length,1);assert.equal(q.unclassified,1);assert.equal(q.reasons.find(r=>r.id==='accuracy').events.length,1);
});
test('duplicate comments, invalid dates, and undated history never inflate period totals',()=>{
 const r=ret('same','2026-11-16T10:00Z');const q=qualityInsights([task('t',{comments:[r,r,ret('bad','invalid')]}),task('u',{returnedAt:'invalid'}),task('working',{status:'in_progress',returnedAt:'2026-10-01'})],'2026-11-16','2026-11-16');
 assert.equal(q.events.length,1);assert.equal(q.repeated.length,0);assert.equal(q.undated,1);assert.equal(q.correcting.length,1);
});
test('queue persists per account and may coalesce only a never-attempted version',async()=>{
 const o=owner();const op=await enqueueReport(o,input());assert.equal((await reportOperations(o))[0].id,op.id);assert.equal((await reportOperations(owner())).length,0);
 const replaced=await enqueueReport(o,input({fields:{done:'Другой полный текст',plan:'',problems:''}}));assert.notEqual(replaced.id,op.id);assert.equal((await reportOperations(o)).length,1);
 const claimed=await claimReport(o,'worker');assert.equal(claimed.id,replaced.id);await settleReport(claimed.id,'worker',{status:'queued'});
 await assert.rejects(enqueueReport(o,input()),/Предыдущая версия/);
});
test('two tabs cannot claim the same operation; an expired lease is recoverable',async()=>{
 const o=owner();await enqueueReport(o,input(),0);const [a,b]=await Promise.all([claimReport(o,'a',1),claimReport(o,'b',1)]);assert.equal([a,b].filter(Boolean).length,1);
 const first=a??b;assert.equal(await claimReport(o,'c',45000),null);const next=await claimReport(o,'c',45002);assert.equal(next.id,first.id);assert.equal(await settleReport(first.id,first.lease,{status:'sent'}),null);
});
test('lost response retries the same id; only server confirmation acknowledges data',async()=>{
 const o=owner(),ids=[];await enqueueReport(o,input(),0);let confirmed=0;
 await flushReportQueue({owner:o,lease:'x',now:()=>1,canSend:()=>true,send:async op=>{ids.push(op.id);throw new TypeError('Failed to fetch');},ack:()=>{confirmed++;}});
 assert.equal(confirmed,0);assert.equal((await reportOperations(o))[0].status,'queued');
 await flushReportQueue({owner:o,lease:'y',now:()=>100000,canSend:()=>true,send:async op=>{ids.push(op.id);return {ok:true,record:{id:'r',updatedAt:'2026-11-16'}};},ack:()=>{confirmed++;}});
 assert.equal(ids[0],ids[1]);assert.equal(confirmed,1);assert.equal((await reportOperations(o))[0].status,'sent');
});
test('conflicts require a new request with explicit server revision; revoked access stays blocked',async()=>{
 const o=owner();const old=await enqueueReport(o,input());await flushReportQueue({owner:o,lease:'x',canSend:()=>true,send:async()=>({ok:false,kind:'conflict',server:{updatedAt:'new'},message:'Changed'}),ack:()=>assert.fail()});
 const resolved=await resolveReportConflict(o,old.id);assert.notEqual(resolved.id,old.id);assert.equal(resolved.baseRevision,'new');
 await flushReportQueue({owner:o,lease:'y',canSend:()=>true,send:async()=>({ok:false,kind:'blocked',message:'Access revoked'}),ack:()=>assert.fail()});assert.equal((await reportOperations(o))[0].status,'blocked');
});
test('account switch after claiming stops sending; offline snapshots expire',async()=>{
 const o=owner();await enqueueReport(o,input());let checks=0;await flushReportQueue({owner:o,lease:'x',canSend:()=>++checks<2,send:async()=>assert.fail('sent after switch'),ack:()=>assert.fail()});assert.equal((await reportOperations(o))[0].status,'queued');
 await saveOfflineSnapshot({owner:o,verifiedAt:100});assert.ok(await readOfflineSnapshot(o,200));assert.equal(await readOfflineSnapshot(o,8*864e5),null);
});
test('a late acknowledgement preserves edits typed after the queued version',()=>{
 const store=new Map(),storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 storage.setItem('k',JSON.stringify({value:{done:'new text'}}));assert.equal(clearSavedDraft('k',{done:'old text'},storage),false);assert.equal(JSON.parse(storage.getItem('k')).value.done,'new text');
});
