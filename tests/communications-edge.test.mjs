import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { admissionToken, createCommunicationsHandler, mediaReady } from '../.test-communications/communications-entry.js';

const uid = '00000000-0000-0000-0000-000000000001';
const origin = 'https://timativ-blip.github.io';
const media = { url: 'wss://isolated-test.livekit.cloud', apiKey: 'test-only-api-key', apiSecret: 'isolated-test-secret-not-for-production' };
function fixture({ profile = { active: true, pending: false }, configured = false, rpcResult = {} } = {}) {
  const calls = [];
  const rpc = (name, args) => ({ abortSignal: async () => { calls.push({ name, ...args }); return { data: rpcResult, error: null }; } });
  const admin = {
    auth: { getUser: async jwt => ({ data: { user: jwt === 'user-session' ? { id: uid } : null }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { data: profile }, error: null }) }) }) }), rpc,
  };
  const handler = createCommunicationsHandler({ admin, userClient: jwt => { assert.equal(jwt, 'user-session'); return { rpc }; }, media: configured ? media : undefined, appOrigin: origin, hookSecret: async () => 'isolated-internal-hook' });
  const request = (body, headers = {}, path = '') => handler(new Request('https://edge.invalid/communications' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-session', Origin: origin, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  return { handler, request, calls };
}

test('production media configuration accepts only secure LiveKit Cloud; localhost is an explicit test-only injection', () => {
  assert.equal(mediaReady(media), true);
  for (const url of ['ws://test.livekit.cloud', 'wss://elsewhere.invalid', 'wss://name:secret@test.livekit.cloud', 'wss://test.livekit.cloud/path', 'wss://test.livekit.cloud/?key=secret', 'ws://127.0.0.1:7880']) assert.equal(mediaReady({ ...media, url }), false, url);
  assert.equal(mediaReady({ ...media, apiSecret: '' }), false);
  assert.equal(mediaReady({ ...media, url: 'ws://127.0.0.1:7880' }, true), true);
});
test('missing provider credentials leave chat enabled, gate video and never return secrets', async () => {
  const f = fixture(); const status = await f.request({ action: 'status' }); assert.equal(status.status, 200); assert.deepEqual(await status.json(), { chatReady: true, videoReady: false, provider: 'livekit-cloud' });
  const create = await f.request({ action: 'create', title: 'Проверка', requestId: randomUUID() }); assert.equal(create.status, 503); assert.equal(f.calls.length, 0);
  assert.equal(status.headers.get('cache-control'), 'no-store'); assert.equal(status.headers.get('access-control-allow-origin'), origin);
});
test('every browser action requires a verified active account and the configured website origin', async () => {
  assert.equal((await fixture().request({ action: 'status' }, { Authorization: '' })).status, 401);
  assert.equal((await fixture().request({ action: 'status' }, { Authorization: 'Bearer forged' })).status, 401);
  for (const profile of [{ active: false }, { active: true, pending: true }]) assert.equal((await fixture({ profile }).request({ action: 'status' })).status, 403);
  assert.equal((await fixture().request({ action: 'status' }, { Origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await fixture().request('null')).status, 400);
  assert.equal((await fixture().request('x'.repeat(262145))).status, 413);
});
test('invitation responses use the caller JWT and remain available before media activation', async () => {
  const f = fixture({ rpcResult: { id: randomUUID(), status: 'declined' } });
  assert.equal((await f.request({ action: 'respond', invitationId: randomUUID(), response: 'declined', requestId: randomUUID() })).status, 200);
  assert.equal(f.calls[0].name, 'communications'); assert.equal(f.calls[0].p_action, 'respond');
  assert.equal((await f.request({ action: 'cleanup' }, { 'x-hook-secret': 'forged' })).status, 401);
  assert.deepEqual(await (await f.request({ action: 'cleanup' }, { 'x-hook-secret': 'isolated-internal-hook' })).json(), { ok: true, processed: 0, videoReady: false });
});
test('media JWT is signed, lasts 90 seconds, is restricted to one opaque identity and room and grants no administration', async () => {
  const identity = randomUUID(), mid = randomUUID();
  const jwt = await admissionToken(media, { userId: uid, identity, room: 'kc_' + mid, name: 'Тестовый сотрудник', meetingId: mid, ownerId: uid });
  const claims = await new TokenVerifier(media.apiKey, media.apiSecret).verify(jwt);
  assert.equal(claims.sub, identity); assert.equal(claims.exp - claims.nbf, 90); assert.equal(claims.video.room, 'kc_' + mid); assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublishData, false); assert.equal(claims.video.canUpdateOwnMetadata, false);
  for (const right of ['roomAdmin', 'roomCreate', 'roomList', 'roomRecord', 'ingressAdmin']) assert.ok(!claims.video[right]);
  assert.deepEqual(JSON.parse(claims.metadata), { uid }); assert.ok(!jwt.includes(media.apiSecret));
  await assert.rejects(new TokenVerifier(media.apiKey, 'different-test-key').verify(jwt));
});
test('webhooks require both valid signature and matching raw body; only managed room events reach the service-only RPC', async () => {
  const f = fixture({ configured: true });
  const body = JSON.stringify({ id: randomUUID(), event: 'participant_joined', createdAt: String(Math.floor(Date.now() / 1000)), room: { name: 'kc_' + randomUUID() }, participant: { identity: randomUUID(), sid: 'PA_fixture' } });
  const grant = new AccessToken(media.apiKey, media.apiSecret, { ttl: 60 }); grant.sha256 = createHash('sha256').update(body).digest('base64'); const auth = await grant.toJwt();
  assert.equal((await f.request(body, { Authorization: 'forged' }, '/webhook')).status, 401);
  assert.equal((await f.request(body + ' ', { Authorization: auth }, '/webhook')).status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request(body, { Authorization: auth }, '/webhook')).status, 200);
  assert.equal(f.calls[0].name, 'communications_media'); assert.equal(f.calls[0].p_action, 'event'); assert.equal(f.calls[0].p_body.event, 'joined');
  const other = body.replace('kc_', 'other_'), otherGrant = new AccessToken(media.apiKey, media.apiSecret, { ttl: 60 }); otherGrant.sha256 = createHash('sha256').update(other).digest('base64');
  assert.equal((await f.request(other, { Authorization: await otherGrant.toJwt() }, '/webhook')).status, 200); assert.equal(f.calls.length, 1);
});
