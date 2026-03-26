/**
 * Integration test helpers — ApiClient, NatsWaiter, and utilities.
 *
 * All interaction with the running Docker app goes through these helpers
 * so test files stay declarative and readable.
 */

import { connect, StringCodec, type NatsConnection, type Subscription } from 'nats';

import type { LTEvent } from '../../types/events';
import type { ApiResponse } from './types';

// ── Logging ──────────────────────────────────────────────────────────────────

export function log(phase: string, message: string): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`  [${ts}] [${phase}] ${message}`);
}

// ── Health check ─────────────────────────────────────────────────────────────

export async function waitForHealth(
  baseUrl = 'http://localhost:3000',
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`Health check at ${baseUrl}/health timed out after ${timeoutMs / 1000}s`);
}

// ── ApiClient ────────────────────────────────────────────────────────────────

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<string> {
    // Seed data creates users asynchronously after startup —
    // retry login until credentials are available.
    const deadline = Date.now() + 60_000;
    let lastError = '';
    while (Date.now() < deadline) {
      try {
        const { data } = await this.post<{ token: string }>('/api/auth/login', { username, password });
        this.token = data.token;
        return data.token;
      } catch (err: any) {
        lastError = err.message;
        if (!err.message.includes('401')) throw err; // Non-auth error — don't retry
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
    throw new Error(`Login failed after 60s: ${lastError}`);
  }

  /** Use a specific token (for multi-role tests). */
  useToken(token: string): void {
    this.token = token;
  }

  // ── Generic request methods ───────────────────────────────────────────────

  async get<T = any>(path: string, query?: Record<string, string>): Promise<ApiResponse<T>> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }
    const res = await fetch(url, { headers: this.headers() });
    const data = await res.json() as T;
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(data)}`);
    return { status: res.status, data };
  }

  async post<T = any>(path: string, body?: any): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json() as T;
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(data)}`);
    return { status: res.status, data };
  }

  async patch<T = any>(path: string, body?: any): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json() as T;
    if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${JSON.stringify(data)}`);
    return { status: res.status, data };
  }

  async delete<T = any>(path: string): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    const data = await res.json() as T;
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}: ${JSON.stringify(data)}`);
    return { status: res.status, data };
  }

  // ── mcpQuery convenience ──────────────────────────────────────────────────

  async startMcpQuery(
    prompt: string,
    opts: { direct?: boolean; wait?: boolean; tags?: string[] } = {},
  ): Promise<any> {
    const { data } = await this.post('/api/insight/mcp-query', {
      prompt,
      direct: opts.direct ?? false,
      wait: opts.wait ?? true,
      tags: opts.tags,
    });
    return data;
  }

  async describeMcpQuery(
    prompt: string,
    resultTitle?: string,
    resultSummary?: string,
  ): Promise<{ description: string; tags: string[] }> {
    const { data } = await this.post('/api/insight/mcp-query/describe', {
      prompt,
      result_title: resultTitle,
      result_summary: resultSummary,
    });
    return data;
  }

  // ── Workflow observation ───────────────────────────────────────────────────

  async getWorkflowStatus(workflowId: string): Promise<any> {
    const { data } = await this.get(`/api/workflows/${workflowId}/status`);
    return data;
  }

  async getWorkflowResult(workflowId: string): Promise<any> {
    const { data } = await this.get(`/api/workflows/${workflowId}/result`);
    return data;
  }

  // ── YAML workflow lifecycle ───────────────────────────────────────────────

  async compileWorkflow(opts: {
    workflow_id: string;
    task_queue: string;
    workflow_name: string;
    name: string;
    app_id?: string;
    description?: string;
    tags?: string[];
  }): Promise<any> {
    const { data } = await this.post('/api/yaml-workflows', opts);
    return data;
  }

  async deployWorkflow(id: string): Promise<any> {
    const { data } = await this.post(`/api/yaml-workflows/${id}/deploy`);
    return data;
  }

  async invokeWorkflow(id: string, inputData: any, sync = false): Promise<any> {
    const { data } = await this.post(`/api/yaml-workflows/${id}/invoke`, {
      data: inputData,
      sync,
    });
    return data;
  }

  async archiveWorkflow(id: string): Promise<any> {
    const { data } = await this.post(`/api/yaml-workflows/${id}/archive`);
    return data;
  }

  async deleteWorkflow(id: string): Promise<any> {
    const { data } = await this.delete(`/api/yaml-workflows/${id}`);
    return data;
  }

  async getYamlWorkflow(id: string): Promise<any> {
    const { data } = await this.get(`/api/yaml-workflows/${id}`);
    return data;
  }

  // ── Escalation management ─────────────────────────────────────────────────

  async listEscalations(query?: Record<string, string>): Promise<{ escalations: any[]; total: number }> {
    const { data } = await this.get('/api/escalations', query);
    return data;
  }

  async getAvailableEscalations(query?: Record<string, string>): Promise<{ escalations: any[]; total: number }> {
    const { data } = await this.get('/api/escalations/available', query);
    return data;
  }

  async getEscalation(id: string): Promise<any> {
    const { data } = await this.get(`/api/escalations/${id}`);
    return data;
  }

  async claimEscalation(id: string): Promise<any> {
    const { data } = await this.post(`/api/escalations/${id}/claim`);
    return data;
  }

  async escalateEscalation(id: string, targetRole: string): Promise<any> {
    const { data } = await this.patch(`/api/escalations/${id}/escalate`, { targetRole });
    return data;
  }

  async resolveEscalation(id: string, resolverPayload: any): Promise<any> {
    const { data } = await this.post(`/api/escalations/${id}/resolve`, { resolverPayload });
    return data;
  }

  // ── Task / Process observation ────────────────────────────────────────────

  async getProcessTasks(originId: string): Promise<any> {
    const { data } = await this.get(`/api/tasks/processes/${encodeURIComponent(originId)}`);
    return data;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }
}

// ── NatsWaiter ───────────────────────────────────────────────────────────────

const sc = StringCodec();

export class NatsWaiter {
  private nc: NatsConnection;
  private subscription: Subscription;
  private events: Array<{ subject: string; event: LTEvent }> = [];
  private closed = false;

  private constructor(nc: NatsConnection, subscription: Subscription) {
    this.nc = nc;
    this.subscription = subscription;
  }

  static async create(
    url = 'nats://localhost:4222',
    token = 'dev_api_secret',
  ): Promise<NatsWaiter> {
    const nc = await connect({ servers: url, token });
    const subscription = nc.subscribe('lt.events.>');

    const waiter = new NatsWaiter(nc, subscription);

    // Collect events in the background
    (async () => {
      for await (const msg of subscription) {
        if (waiter.closed) break;
        try {
          const event = JSON.parse(sc.decode(msg.data)) as LTEvent;
          waiter.events.push({ subject: msg.subject, event });
        } catch { /* ignore malformed */ }
      }
    })();

    // Small delay to ensure subscription is active
    await new Promise((r) => setTimeout(r, 100));
    return waiter;
  }

  /**
   * Wait for an event matching the predicate.
   * Checks already-buffered events first, then polls every 500ms.
   */
  async waitForEvent(
    predicate: (event: LTEvent) => boolean,
    timeoutMs = 300_000,
  ): Promise<LTEvent> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const match = this.events.find((e) => predicate(e.event));
      if (match) return match.event;
      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(`NatsWaiter: timed out after ${timeoutMs / 1000}s waiting for event`);
  }

  /** Wait for a workflow.completed event for the given workflowId. */
  async waitForWorkflowComplete(workflowId: string, timeoutMs = 300_000): Promise<LTEvent> {
    return this.waitForEvent(
      (e) =>
        e.type === 'workflow.completed' &&
        (e.workflowId === workflowId || e.workflowId?.includes(workflowId)),
      timeoutMs,
    );
  }

  /** Wait for an escalation.created event related to a workflowId or originId. */
  async waitForEscalation(workflowIdOrOriginId: string, timeoutMs = 300_000): Promise<LTEvent> {
    return this.waitForEvent(
      (e) =>
        e.type === 'escalation.created' &&
        (e.workflowId === workflowIdOrOriginId ||
          e.originId === workflowIdOrOriginId ||
          e.workflowId?.includes(workflowIdOrOriginId)),
      timeoutMs,
    );
  }

  /** Get all collected events for a workflowId (including child workflows). */
  getEventsForWorkflow(workflowId: string): LTEvent[] {
    return this.events
      .filter((e) => e.event.workflowId === workflowId || e.event.workflowId?.includes(workflowId))
      .map((e) => e.event);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.subscription.unsubscribe();
    await this.nc.drain();
  }
}

// ── Polling fallback ─────────────────────────────────────────────────────────

/**
 * Poll workflow status until complete (status === 0) or timeout.
 * Used as fallback when NATS event delivery is unreliable.
 */
export async function pollForCompletion(
  api: ApiClient,
  workflowId: string,
  timeoutMs = 300_000,
  intervalMs = 5_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const result = await api.getWorkflowStatus(workflowId);
      if (result.status === 0) return result;
    } catch { /* workflow not found yet — keep polling */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Polling: workflow ${workflowId} did not complete within ${timeoutMs / 1000}s`);
}

/**
 * Poll until a predicate returns a truthy value, or timeout.
 */
export async function poll<T>(
  label: string,
  fn: () => Promise<T | null | undefined>,
  timeoutMs = 30_000,
  intervalMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for: ${label} (${timeoutMs / 1000}s)`);
}
