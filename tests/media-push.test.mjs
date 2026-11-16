import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as webpush from 'web-push';
import { createPushHandler, validateSubscription, pushPayload } from '../.test-media/media-entry.js';
const ecdh=createECDH('prime256v1');ecdh.generateKeys();
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test-device',keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
function fixture(){const writes=[];let dispatches=0;const handler=createPushHandler({authorize:async t=>t==='valid'?'own-user':null,publicKey:async()=>'PUBLIC-KEY',hookSecret:async()=>'internal-secret',subscribe:async(...x)=>writes.push(['subscribe',...x]),unsubscribe:async(...x)=>writes.push(['unsubscribe',...x]),test:async(...x)=>writes.push(['test',...x]),dispatch:async()=>({processed:++dispatches})});return{handler,writes};}
const request=(body,headers={authorization:'Bearer valid',origin:'https://timativ-blip.github.io'})=>new Request('https://api.test/web-push',{method:'POST',headers,body:JSON.stringify(body)});
test('device subscriptions require auth, enforce own identity, and reject foreign origins',async()=>{
 const {handler,writes}=fixture();assert.equal((await handler(request({action:'status'},{}))).status,401);
 assert.equal((await handler(request({action:'status'},{authorization:'Bearer valid',origin:'https://evil.test'}))).status,403);
 const r=await handler(request({action:'subscribe',userId:'other-user',subscription:sub,muted:['report','report']}));assert.equal(r.status,200);
 assert.deepEqual(writes[0],['subscribe','own-user',{...sub,expirationTime:null},['report']]);
 assert.deepEqual(await(await handler(request({action:'status'}))).json(),{ready:true,publicKey:'PUBLIC-KEY'});
 assert.equal((await handler(request({action:'dispatch'}))).status,403);
 assert.equal((await handler(request({action:'dispatch'},{'x-hook-secret':'internal-secret'}))).status,200);
});
test('push never sends capabilities or VAPID tokens to arbitrary or private network addresses',()=>{
 for(const endpoint of ['https://127.0.0.1/private','http://fcm.googleapis.com/test','https://fcm.googleapis.com.evil.test/x','https://web.push.apple.com:8080/x','https://user:pass@fcm.googleapis.com/x','https://foo.test/'])assert.throws(()=>validateSubscription({...sub,endpoint}));
 for(const endpoint of ['https://web.push.apple.com/Qx','https://updates.push.services.mozilla.com/wpush/v2/test','https://wns.notify.windows.com/test'])assert.equal(validateSubscription({...sub,endpoint}).endpoint,endpoint);
 assert.throws(()=>validateSubscription({...sub,keys:{auth:'bad',p256dh:'bad'}}));
 const p=pushPayload({id:'n1',kind:'report',text:'A'.repeat(700),link:'https://evil.test/'});assert.equal(p.body.length,300);assert.equal(p.link,'#/home');
});
test('the production web-push library encrypts notification bodies and signs a VAPID request',()=>{
 const keys=webpush.generateVAPIDKeys();const r=webpush.generateRequestDetails(sub,JSON.stringify({body:'private task text'}),{vapidDetails:{subject:'https://timativ-blip.github.io/nlMO/',...keys},TTL:3600,contentEncoding:'aes128gcm'});
 assert.equal(r.headers['Content-Encoding'],'aes128gcm');assert.match(r.headers.Authorization,/^vapid /);assert.equal(r.body.includes(Buffer.from('private task text')),false);
});
test('service worker shows a visible push and only opens routes within the application',async()=>{
 const handlers={},shown=[],opened=[];let done;
 const self={registration:{scope:'https://timativ-blip.github.io/nlMO/',showNotification:async(...args)=>shown.push(args)},addEventListener:(name,fn)=>handlers[name]=fn,clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL});
 handlers.push({data:{json:()=>({id:'n1',title:'Отчёт дня',body:'Заполните отчёт',link:'#/daily'})},waitUntil:p=>done=p});await done;
 assert.equal(shown[0][1].data.link,'#/daily');assert.equal(shown[0][1].tag,'kc-n1');
 handlers.notificationclick({notification:{close(){},data:{link:'https://evil.test/'}},waitUntil:p=>done=p});await done;assert.equal(opened[0],'https://timativ-blip.github.io/nlMO/#/home');
});
