/** The session is over. The only thing that may log someone out. */
export class SignedOut extends Error {}

/** No usable answer: no network, too slow, server trouble, or something that is not our server. */
export class Unreachable extends Error {
  readonly kind: 'network' | 'server';
  constructor(kind: 'network' | 'server', message: string) {
    super(message);
    this.kind = kind;
  }
}

/** The server understood and said no. */
export class Refused extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Reply<T> = { data: T; sentAt: number; receivedAt: number; etag: string | null; notModified: boolean };

type Options = { baseUrl: string; fetch: typeof fetch; now: () => number; timeoutMs?: number };

export class Api {
  private token: string | null = null;
  /** Dev menu: behave as if there is no connection, except to the dev tools themselves. */
  pretendOffline = false;
  readonly baseUrl: string;
  private readonly options: Options;
  private readonly running = new Map<AbortController, string>();

  constructor(options: Options) {
    this.options = options;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  startSession(token: string): void {
    this.token = token;
  }

  /** However it ends. The dev menu is out of reach after this, so nothing it turned on may stay on. */
  endSession(): void {
    this.token = null;
    this.pretendOffline = false;
  }

  /** Calls that hang are let go, so they can be made again. Only those that may be repeated. */
  giveUp(paths: string[]): void {
    for (const [abort, path] of this.running) if (paths.some((start) => path.startsWith(start))) abort.abort();
  }

  async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: object, headers: Record<string, string> = {}): Promise<Reply<T>> {
    if (this.pretendOffline && !path.startsWith('/dev/')) throw new Unreachable('network', 'Pretending to be offline');
    const token = this.token;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.options.timeoutMs ?? 15_000);
    this.running.set(abort, path);
    const sentAt = this.options.now();
    let status: number;
    let text: string;
    let etag: string | null;
    try {
      const res = await this.options.fetch(this.baseUrl + path, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: abort.signal,
      });
      status = res.status;
      etag = res.headers.get('etag');
      text = await res.text();
    } catch (err) {
      throw new Unreachable('network', (err as Error).message);
    } finally {
      this.running.delete(abort);
      clearTimeout(timer);
    }
    const receivedAt = this.options.now();
    if (status === 304) return { data: null as T, sentAt, receivedAt, etag, notModified: true };
    if (status >= 500 || status === 408 || status === 429) throw new Unreachable('server', `The server said ${status}`);

    // Hotel wifi and proxies answer too. Only a reply in our own shape counts as an answer.
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Unreachable('network', 'That was not our server');
      }
    }
    if (status >= 200 && status < 300) return { data: data as T, sentAt, receivedAt, etag, notModified: false };
    const problem = data as { error?: unknown; message?: unknown } | null;
    if (typeof problem?.error !== 'string') throw new Unreachable('network', `Unexpected reply ${status}`);
    if (status === 401 && problem.error === 'signed_out') {
      // A late reply to an old session must not end the new one.
      if (token !== null && token === this.token) throw new SignedOut('Please log in again.');
      throw new Unreachable('network', 'That was an old session');
    }
    throw new Refused(status, problem.error, String(problem.message ?? 'Something went wrong.'));
  }
}
