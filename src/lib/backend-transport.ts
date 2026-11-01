/** Routes this project's HTTP APIs through its configured gateway. WebSockets keep their original URL. */
export function createBackendTransport(backendUrl: string, gatewayUrl?: string, send: typeof fetch = globalThis.fetch) {
  const backend = new URL(backendUrl);
  const gateway = gatewayUrl ? new URL(gatewayUrl) : null;
  if (gateway && (gateway.protocol !== 'https:' || gateway.username || gateway.password || gateway.pathname !== '/' || gateway.search || gateway.hash))
    throw new Error('Неверный адрес сервиса соединения.');

  function route(value: string): string {
    if (!gateway) return value;
    let target: URL;
    try { target = new URL(value); } catch { return value; }
    if (target.origin !== backend.origin || !/^\/(auth|rest|storage|functions)\/v1(?:\/|$)/.test(target.pathname)) return value;
    return gateway.origin + target.pathname + target.search;
  }

  const request: typeof fetch = (input, init) => {
    const target = input instanceof Request ? new Request(route(input.url), input) : route(String(input));
    // Never replay a write after a network error: it may already have reached the database.
    return send(target, { ...init, cache: 'no-store' });
  };
  return { route, fetch: request };
}
