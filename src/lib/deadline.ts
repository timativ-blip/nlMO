export class RequestTimeoutError extends Error {
  constructor(message: string) { super(message); this.name = 'RequestTimeoutError'; }
}

/** Bounds the complete operation, including body parsing and SDK session locks. */
export async function withDeadline<T>(operation: (signal: AbortSignal) => PromiseLike<T>, milliseconds: number, message: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new RequestTimeoutError(message)); controller.abort(); }, milliseconds);
  });
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]); }
  finally { clearTimeout(timer); }
}
