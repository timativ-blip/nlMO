import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const realTimeout = globalThis.setTimeout;
// Accelerate long network deadlines while keeping normal event ordering.
globalThis.setTimeout = (fn, ms, ...args) => realTimeout(fn, Math.min(ms ?? 0, 45), ...args);
globalThis.window = { addEventListener() {} };
let entries = new Map();
globalThis.localStorage = { getItem: (key) => entries.get(key) ?? null, setItem: (key,value) => entries.set(key,value), removeItem: (key) => entries.delete(key) };
let reloads = 0;
globalThis.location = { reload: () => { reloads++; } };
after(() => { globalThis.setTimeout = realTimeout; });
const wait = (ms = 5) => new Promise((resolve) => realTimeout(resolve,ms));
let sequence = 0;
async function start(config = {}) {
  globalThis.__startupTest = config;
  const app = await import(`../.test-startup/startup-entry.js?case=${++sequence}`);
  await wait();
  return app;
}

test('anonymous login renders before a stalled initialization probe', async () => {
  const app = await start({ probeHang: true });
  assert.equal(app.getPhase().phase,'signed-out');
  await wait(65);
  assert.equal(app.getPhase().phase,'signed-out');
  assert.match(app.getPhase().error,/не ответил вовремя/);
});

test('an initialized project shows login and an empty project still shows setup', async () => {
  assert.equal((await start()).getPhase().phase,'signed-out');
  assert.equal((await start({initialized:false})).getPhase().phase,'setup');
});

test('a probe error is visible without hiding the sign-in form', async () => {
  const app=await start({probeError:true});
  assert.equal(app.getPhase().phase,'signed-out');
  assert.match(app.getPhase().error,/Нет связи/);
});

test('a stuck auth session cannot leave an infinite loading screen', async () => {
  entries.set('sb-test-auth-token','unchanged-session');
  const app=await start({authHang:true});
  await wait(65);
  assert.equal(app.getPhase().phase,'error');
  assert.match(app.getPhase().error,/не ответил вовремя/);
  assert.equal(entries.get('sb-test-auth-token'),'unchanged-session');
});

test('a valid session loads the workspace without waiting for an optional journal', async () => {
  const app=await start({signedIn:true,role:'head',auditHang:true});
  assert.equal(app.getPhase().phase,'ready');
  assert.equal(app.getState().session.userId,'test-user');
  await wait(65);
  assert.equal(app.getPhase().phase,'ready');
});

test('stalled data queries are aborted and show a retryable error', async () => {
  const config={signedIn:true,loadHang:true};
  const app=await start(config);
  await wait(65);
  assert.equal(app.getPhase().phase,'error');
  assert.equal(config.aborted,11);
});

test('auth callbacks defer SDK queries until after the callback has returned', async () => {
  const config={};
  const app=await start(config);
  config.emit('SIGNED_IN');
  assert.equal(app.getState().session.userId,'');
  await wait();
  assert.equal(app.getPhase().phase,'ready');
});

test('a signed-out session cannot be overwritten by a late data response', async () => {
  const config={signedIn:true,holdLoad:true};
  const app=await start(config);
  config.emit('SIGNED_OUT',null);
  await wait();
  config.completeLoads.forEach((done)=>done());
  await wait();
  assert.equal(app.getPhase().phase,'signed-out');
  assert.equal(app.getState().session.userId,'');
  assert.deepEqual(app.getState().users,[]);
});

test('late realtime events from the old account cannot restore its data after sign-out', async () => {
  const config={signedIn:true};
  const app=await start(config);
  assert.equal(app.getPhase().phase,'ready');
  const events=config.liveCallbacks.filter(({filter})=>['tasks','profiles','telegram_links'].includes(filter.table));
  assert.equal(events.length,3);
  config.emit('SIGNED_OUT',null);await wait();
  for(const {filter,listener} of events)listener({eventType:'INSERT',new:{data:{id:'old-account-private-data'},user_id:'test-user'},old:{}});
  assert.deepEqual(app.getState().tasks,[]);assert.deepEqual(app.getState().users,[]);assert.equal(app.getState().extras.telegramLinked,undefined);
});

test('recovery only clears this project session after the explicit action', async () => {
  const app=await start();
  entries=new Map([['sb-test-auth-token','session'],['sb-test-auth-token-code-verifier','verifier'],['kc-appearance-v1','dark'],['kc-mo-demo','demo'],['sb-other-auth-token','other']]);
  app.restartSignIn();
  assert.equal(entries.has('sb-test-auth-token'),false);
  assert.equal(entries.get('kc-appearance-v1'),'dark');
  assert.equal(entries.get('kc-mo-demo'),'demo');
  assert.equal(entries.get('sb-other-auth-token'),'other');
  assert.equal(reloads,1);
});

test('deadline covers a response whose headers arrived but whose body never finishes', async () => {
  const app=await start();
  await assert.rejects(app.withDeadline(async () => { const response={json:()=>new Promise(()=>{})}; return response.json(); },5,'body timeout'),{name:'RequestTimeoutError',message:'body timeout'});
  assert.equal(await app.withDeadline(async()=>42,5,'unused'),42);
});
