// In-memory API fixture. No requests, real accounts or credentials are used by these tests.
const config = (globalThis as any).__startupTest;
export const AUTH_STORAGE_KEY = 'sb-test-auth-token';
export const BACKEND = true;
export const FUNCTIONS_URL = 'https://example.invalid/functions/v1';
const user = { id: 'test-user', name: 'Test User', role: config.role ?? 'member', active: true, districtId: null };
const session = { user: { id: user.id } };

function query(name: string) {
  if (config.inCallback) throw new Error('A query ran inside the auth callback');
  let signal: AbortSignal | undefined;
  const row = () => {
    if (name === 'is_initialized') return { data: config.initialized ?? true, error: config.probeError ? { message: 'NetworkError' } : null };
    if (name === 'my_status') return { data: { exists: true, pending: config.pending ?? false, name: 'Test User' }, error: null };
    if (name === 'profiles') return { data: config.pending ? [] : [{ data: user }], error: null };
    return { data: [], error: null };
  };
  const q: any = {
    select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q,
    abortSignal: (value: AbortSignal) => { signal = value; return q; },
    then: (resolve: any, reject: any) => {
      const hang = (name === 'is_initialized' && config.probeHang) || (name === 'audit_log' && config.auditHang) || (name !== 'is_initialized' && name !== 'audit_log' && config.loadHang);
      const promise = hang || config.holdLoad && name !== 'is_initialized'
        ? new Promise((done, fail) => {
          if (config.holdLoad) (config.completeLoads ??= []).push(() => done(row()));
          const abort = () => { config.aborted = (config.aborted ?? 0)+1; fail(new Error('aborted')); };
          if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
        }) : Promise.resolve(row());
      return promise.then(resolve,reject);
    },
  };
  return q;
}
const channel: any = { on: () => channel, subscribe: () => channel, unsubscribe: () => {} };
export const sb: any = {
  auth: {
    getSession: () => config.authHang ? new Promise(() => {}) : Promise.resolve({ data: { session: config.signedIn ? session : null }, error: null }),
    onAuthStateChange: (listener: any) => {
      config.emit = (event: string, value = session) => { config.inCallback = true; listener(event,value); config.inCallback = false; };
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
  from: query, rpc: query, channel: () => channel,
};
