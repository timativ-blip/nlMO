import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createBackendTransport } from '../.test-connection/backend-transport.js';

const origin = 'https://project.supabase.co';
const gateway = 'https://connection.example.invalid';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('only the configured project HTTP APIs use the gateway; external links and WebSockets keep their address', () => {
  const transport = createBackendTransport(origin, gateway);
  assert.equal(transport.route(`${origin}/rest/v1/tasks?select=data&id=eq.a`), `${gateway}/rest/v1/tasks?select=data&id=eq.a`);
  assert.equal(transport.route(`${origin}/functions/v1/telegram`), `${gateway}/functions/v1/telegram`);
  for (const url of ['https://other.supabase.co/rest/v1/tasks', 'https://project.supabase.co.evil.invalid/rest/v1/tasks', `${origin}/not-an-api`, 'wss://project.supabase.co/realtime/v1/websocket', '/local-map.json']) assert.equal(transport.route(url), url);
  assert.equal(createBackendTransport(origin).route(`${origin}/auth/v1/token`), `${origin}/auth/v1/token`);
});

test('gateway configuration cannot add URL credentials, a query, a fragment, an insecure protocol or a path', () => {
  for (const bad of ['http://insecure.invalid', 'https://user:password@connection.invalid', `${gateway}/other`, `${gateway}?target=evil`, `${gateway}#fragment`]) assert.throws(() => createBackendTransport(origin, bad));
});

test('a write keeps its method, bearer token, content headers, body and cancellation signal and is never cached', async () => {
  const controller = new AbortController();
  const init = { method: 'PATCH', headers: { Authorization: 'Bearer user-session', apikey: 'public-key', Prefer: 'return=representation' }, body: '{"data":{"title":"Saved once"}}', signal: controller.signal };
  let calls = 0;
  const transport = createBackendTransport(origin, gateway, async (url, options) => {
    calls++;
    assert.equal(url, `${gateway}/rest/v1/tasks?id=eq.a`);
    assert.equal(options.method, init.method); assert.equal(options.body, init.body);
    assert.deepEqual(options.headers, init.headers); assert.equal(options.signal, controller.signal);
    assert.equal(options.cache, 'no-store');
    return json([{ data: { id: 'a' } }]);
  });
  assert.deepEqual(await (await transport.fetch(`${origin}/rest/v1/tasks?id=eq.a`, init)).json(), [{ data: { id: 'a' } }]);
  assert.equal(calls, 1);
});

test('Request inputs, signed file URLs and URL objects retain their data through routing', async () => {
  const controller = new AbortController();
  const req = new Request(`${origin}/storage/v1/object/attachments/user/file.txt?token=signed-token`, { method: 'POST', body: 'file body', headers: { Authorization: 'Bearer user-session', 'x-upsert': 'false' }, signal: controller.signal });
  const transport = createBackendTransport(origin, gateway, async (input, init) => {
    const r = new Request(input, init);
    assert.equal(r.url, `${gateway}/storage/v1/object/attachments/user/file.txt?token=signed-token`);
    assert.equal(r.method, 'POST'); assert.equal(r.headers.get('Authorization'), 'Bearer user-session'); assert.equal(r.headers.get('x-upsert'), 'false');
    assert.equal(await r.text(), 'file body');
    controller.abort(); assert.equal(r.signal.aborted, true);
    return json({ ok: true });
  });
  await transport.fetch(req);
  const simple = createBackendTransport(origin, gateway, async (input) => { assert.equal(input, `${gateway}/rest/v1/tasks`); return json([]); });
  await simple.fetch(new URL(`${origin}/rest/v1/tasks`));
});

test('a lost write response is not automatically repeated, and permission errors remain permission errors', async () => {
  let calls = 0;
  const failure = new TypeError('Failed to fetch');
  const failed = createBackendTransport(origin, gateway, async () => { calls++; throw failure; });
  await assert.rejects(failed.fetch(`${origin}/rest/v1/tasks`, { method: 'POST', body: '{}' }), (error) => error === failure);
  assert.equal(calls, 1);
  const denied = createBackendTransport(origin, gateway, async () => json({ message: 'permission denied' }, 403));
  const response = await denied.fetch(`${origin}/rest/v1/tasks`);
  assert.equal(response.status, 403); assert.equal((await response.json()).message, 'permission denied');
});

test('the real Supabase SDK uses the gateway for password login, reads, uploads and functions while keeping the original auth identity', async () => {
  const user = { id: 'connection-test-user', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const access = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url')}.fixture`;
  const calls = [];
  const transport = createBackendTransport(origin, gateway, async (url, options = {}) => {
    const target = new URL(url instanceof Request ? url.url : url);
    calls.push(target.pathname);
    assert.equal(target.origin, gateway); assert.equal(options.cache, 'no-store');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('apikey'), 'fixture-anon-key');
    if (target.pathname === '/auth/v1/token') {
      assert.equal(JSON.parse(options.body).email, user.email);
      return json({ access_token: access, refresh_token: 'fixture-refresh-token', expires_in: 3600, token_type: 'bearer', user });
    }
    assert.equal(headers.get('Authorization'), `Bearer ${access}`);
    if (target.pathname === '/rest/v1/rpc/is_initialized') return json(true);
    if (target.pathname === '/rest/v1/profiles') return json([{ data: { id: user.id } }]);
    if (target.pathname === '/storage/v1/object/attachments/user/file.bin') {
      assert.ok(options.body instanceof FormData);
      const file = [...options.body.values()].find((x) => x instanceof Blob);
      assert.equal(file.size, 10 * 1024 * 1024);
      return json({ Key: 'attachments/user/file.bin', Id: 'fixture-file-id' });
    }
    if (target.pathname === '/storage/v1/object/sign/attachments/user/file.bin') return json({ signedURL: '/object/sign/attachments/user/file.bin?token=fixture-signature' });
    if (target.pathname === '/functions/v1/telegram') return json({ ok: true });
    throw new Error(`Unexpected fixture route: ${target.pathname}`);
  });
  const db = createClient(origin, 'fixture-anon-key', { global: { fetch: transport.fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-project-auth-token' } });
  assert.equal((await db.auth.signInWithPassword({ email: user.email, password: 'fixture-password' })).error, null);
  assert.equal((await db.rpc('is_initialized')).data, true);
  assert.equal((await db.from('profiles').select('data')).data[0].data.id, user.id);
  assert.equal((await db.storage.from('attachments').upload('user/file.bin', new Blob([new Uint8Array(10 * 1024 * 1024)]))).error, null);
  const signed = await db.storage.from('attachments').createSignedUrl('user/file.bin', 3600);
  assert.equal(signed.error, null);
  assert.equal(transport.route(signed.data.signedUrl), `${gateway}/storage/v1/object/sign/attachments/user/file.bin?token=fixture-signature`);
  assert.equal((await db.functions.invoke('telegram', { body: { action: 'setup' } })).data.ok, true);
  assert.deepEqual(calls, ['/auth/v1/token', '/rest/v1/rpc/is_initialized', '/rest/v1/profiles', '/storage/v1/object/attachments/user/file.bin', '/storage/v1/object/sign/attachments/user/file.bin', '/functions/v1/telegram']);
  assert.ok(db.realtime.endPoint.startsWith('wss://project.supabase.co/realtime/v1'));
});

test('the gateway has fixed destinations and disables shared caching of every API response', async () => {
  const config = JSON.parse(await readFile(new URL('../infra/connection/vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.rewrites.length, 4);
  for (const route of config.rewrites) assert.equal(new URL(route.destination).origin, 'https://wlqwwhshqrqanapsnsik.supabase.co');
  const headers = Object.fromEntries(config.headers.find((x) => x.source === '/:path*').headers.map((x) => [x.key.toLowerCase(), x.value]));
  assert.equal(headers['x-vercel-enable-rewrite-caching'], '0');
  assert.match(headers['cache-control'], /private.*no-store/);
  assert.equal(headers['cdn-cache-control'], 'no-store'); assert.equal(headers['vercel-cdn-cache-control'], 'no-store');
  assert.equal(config.functions, undefined);
});
