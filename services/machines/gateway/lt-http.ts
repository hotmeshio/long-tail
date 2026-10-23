/**
 * The gateway's HTTP client to Long Tail. A non-2xx response throws
 * LtHttpError with the status, body and request; the escalation verbs turn
 * the outcomes that mean "already done" (404, 409) and "invalid" (422) into
 * VerbResults and let every other failure throw, so the message that caused
 * it is delivered again.
 */

import { isUuid } from '../../../lib/uuid';
import type { OpenRowQuery } from '../rows';
import { CONTROLLER, type Actor, type CreateRowInput } from './actions';
import { OPEN_PAGE, VERB_OUTCOME, readAllPages, verbOutcomeOf, type LineEscalations, type RowItem, type VerbResult } from './escalations';

export class LtHttpError extends Error {
  readonly cause?: unknown;

  constructor(
    message: string,
    readonly status: number | undefined,
    readonly body: unknown,
    readonly context: { method: string; path: string; elapsedMs: number },
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'LtHttpError';
    this.cause = options?.cause;
  }
}

export class LtHttp {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 10_000) {}

  async request<T = any>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const context = () => ({ method, path, elapsedMs: Math.round(performance.now() - started) });
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      const reason = controller.signal.aborted ? `timed out after ${this.timeoutMs} ms` : err.message;
      throw new LtHttpError(`${method} ${path}: ${reason}`, undefined, undefined, context(), { cause: err });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    const parsed = (res.headers.get('content-type') ?? '').includes('json') && text ? JSON.parse(text) : text;
    if (!res.ok) throw new LtHttpError(`${method} ${path} → ${res.status}`, res.status, parsed, context());
    return parsed as T;
  }
}

/** Escalation verbs over HTTP, each run with the bearer token of the actor it runs as. */
export class HttpLineEscalations implements LineEscalations {
  constructor(
    private readonly http: LtHttp,
    private readonly tokenFor: (as: Actor) => string,
    private readonly claimMinutes = 24 * 60,
  ) {}

  claim(as: Actor, id: string): Promise<VerbResult> {
    return this.verb(as, 'POST', `/escalations/${id}/claim`, { durationMinutes: this.claimMinutes });
  }

  accumulate(as: Actor, id: string, itemKey: string, payload: Record<string, any>, metadata?: Record<string, any>): Promise<VerbResult> {
    return this.verb(as, 'POST', `/escalations/${id}/accumulate`, { itemKey, payload, ...(metadata ? { metadata } : {}) });
  }

  resolve(as: Actor, id: string, payload: Record<string, any>): Promise<VerbResult> {
    return this.verb(as, 'POST', `/escalations/${id}/resolve`, { resolverPayload: payload });
  }

  async create(as: Actor, input: CreateRowInput): Promise<{ id: string }> {
    const row = await this.http.request<{ id: string }>('POST', '/escalations', this.tokenFor(as), input);
    return { id: row.id };
  }

  async itemKeys(id: string): Promise<string[]> {
    return (await this.items(id)).map((i) => i.itemKey);
  }

  async items(id: string): Promise<RowItem[]> {
    const view = await this.http.request<{ items: { itemKey: string; payload?: Record<string, any> }[] }>(
      'GET', `/escalations/${id}/items`, this.tokenFor(CONTROLLER),
    );
    return view.items.map((i) => ({ itemKey: i.itemKey, payload: i.payload ?? {} }));
  }

  async get(id: string): Promise<Record<string, any> | null> {
    if (!isUuid(id)) return null;
    try {
      return await this.http.request<Record<string, any>>('GET', `/escalations/${encodeURIComponent(id)}`, this.tokenFor(CONTROLLER));
    } catch (err) {
      if (err instanceof LtHttpError && (err.status === 403 || err.status === 404)) return null;
      throw err;
    }
  }

  async listOpen(filter: OpenRowQuery): Promise<Record<string, any>[]> {
    return readAllPages(async (offset) => {
      const query = new URLSearchParams({
        ...filter, status: 'pending', limit: String(OPEN_PAGE), offset: String(offset), sort_by: 'created_at', order: 'asc',
      });
      const page = await this.http.request<{ escalations: Record<string, any>[] }>('GET', `/escalations?${query}`, this.tokenFor(CONTROLLER));
      return page.escalations;
    });
  }

  private async verb(as: Actor, method: string, path: string, body: unknown): Promise<VerbResult> {
    try {
      await this.http.request(method, path, this.tokenFor(as), body);
      return { outcome: VERB_OUTCOME.DONE };
    } catch (err) {
      const outcome = err instanceof LtHttpError && err.status !== undefined ? verbOutcomeOf(err.status) : null;
      if (!outcome) throw err;
      return { outcome, detail: JSON.stringify((err as LtHttpError).body), status: (err as LtHttpError).status };
    }
  }
}
