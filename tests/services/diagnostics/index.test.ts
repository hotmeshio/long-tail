import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockResolve = vi.fn();
const mockExport = vi.fn();
const mockStream = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));
vi.mock('../../../services/task/resolve', () => ({
  resolveWorkflowHandle: (...args: unknown[]) => mockResolve(...args),
}));
vi.mock('../../../services/export', () => ({
  exportWorkflowExecution: (...args: unknown[]) => mockExport(...args),
}));
vi.mock('../../../services/controlplane', () => ({
  getStreamMessages: (...args: unknown[]) => mockStream(...args),
}));

import { findStalledJobs, findOrphanedSignals, diagnoseJob } from '../../../services/diagnostics';

beforeEach(() => {
  mockQuery.mockReset();
  mockResolve.mockReset();
  mockExport.mockReset();
  mockStream.mockReset();
});

// ── findStalledJobs ────────────────────────────────────────────────────────

describe('findStalledJobs', () => {
  it('classifies rows (waiting vs no_recent_progress) and bounds the scan', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ workflow_id: 'wf-1', likely: 'waiting', has_open_escalation: true }] });

    const result = await findStalledJobs({ appId: 'durable' });
    expect(result.jobs).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('has_open_escalation');
    expect(sql).toContain('likely');
    expect(params[0]).toBe('hmsh:durable:j:'); // key prefix
    expect(params[1]).toBe('5');               // default idle_minutes
    expect(params[2]).toBeNull();              // workflow_type
  });

  it('clamps limit to 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await findStalledJobs({ appId: 'durable', limit: 9999 });
    expect(mockQuery.mock.calls[0][1][3]).toBe(200);
  });
});

// ── findOrphanedSignals ─────────────────────────────────────────────────────

describe('findOrphanedSignals', () => {
  it('applies a recent time window and returns the window used', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ job_id: 'wf-1', missing_queue_config: true }] });

    const result = await findOrphanedSignals({ appId: 'durable' });
    expect(result.within_hours).toBe(24); // default

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("created_at > NOW()"); // bounded scan, not full history
    expect(params[0]).toBe('24');                // within_hours
    expect(params[1]).toBe(100);                 // default limit
  });

  it('clamps within_hours to the [1, 720] range and limit to 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await findOrphanedSignals({ withinHours: 9999, limit: 9999 });
    expect(result.within_hours).toBe(720);
    expect(mockQuery.mock.calls[0][1][1]).toBe(500);
  });
});

// ── diagnoseJob — event cap ─────────────────────────────────────────────────

function makeEvents(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    event_id: i + 1,
    event_type: i === 0 ? 'workflow_execution_started' : 'activity_task_completed',
    category: 'activity',
    event_time: new Date(Date.now() - (n - i) * 1000).toISOString(),
    duration_ms: 1,
    is_system: false,
    attributes: {},
  }));
}

describe('diagnoseJob — event volume guard', () => {
  beforeEach(() => {
    mockResolve.mockResolvedValue({ taskQueue: 'tq', workflowName: 'reviewContent' });
    mockStream.mockResolvedValue({ messages: [] });
    mockQuery.mockResolvedValue({ rows: [] }); // no escalation row
  });

  it('caps execution_events to the most recent maxEvents and flags truncation (when events included)', async () => {
    mockExport.mockResolvedValue({ events: makeEvents(600) });

    const d = await diagnoseJob('wf-1', 'durable', { maxEvents: 500, include: ['events'] });
    expect(d.total_events).toBe(600);
    expect(d.events_truncated).toBe(true);
    expect(d.execution_events).toHaveLength(500);
  });

  it('does not truncate when events fit under the cap', async () => {
    mockExport.mockResolvedValue({ events: makeEvents(10) });

    const d = await diagnoseJob('wf-1', 'durable', { maxEvents: 500, include: ['events'] });
    expect(d.total_events).toBe(10);
    expect(d.events_truncated).toBe(false);
    expect(d.execution_events).toHaveLength(10);
  });
});

// ── diagnoseJob — compact by default (token economy) ─────────────────────────

describe('diagnoseJob — compact verdict by default', () => {
  beforeEach(() => {
    mockResolve.mockResolvedValue({ taskQueue: 'tq', workflowName: 'reviewContent' });
    mockStream.mockResolvedValue({ messages: [] });
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('omits execution_events and stream_messages, keeps counts, and points to list_stream_messages', async () => {
    mockExport.mockResolvedValue({ events: makeEvents(50) });

    const d = await diagnoseJob('wf-1', 'durable');
    // Verdict fields present
    expect(d.status).toBeDefined();
    expect(d.stream_summary).toBeDefined();
    expect(d.findings).toBeDefined();
    expect(d.total_events).toBe(50);
    // Heavy arrays omitted by default
    expect(d.execution_events).toBeUndefined();
    expect(d.stream_messages).toBeUndefined();
    // Pointer to the raw payload browser
    expect(d.raw_messages?.jid).toBe('wf-1');
    expect(d.raw_messages?.hint).toContain('list_stream_messages');
  });

  it("verbosity:'full' includes both events and streams", async () => {
    mockExport.mockResolvedValue({ events: makeEvents(5) });
    mockStream.mockResolvedValue({ messages: [] });

    const d = await diagnoseJob('wf-1', 'durable', { verbosity: 'full' });
    expect(d.execution_events).toHaveLength(5);
    expect(d.stream_messages).toEqual({ worker: [], engine: [] });
    expect(d.raw_messages).toBeUndefined();
  });
});

// ── diagnoseJob — large-payload truncation ───────────────────────────────────

describe('diagnoseJob — large string summarization', () => {
  beforeEach(() => {
    mockResolve.mockResolvedValue({ taskQueue: 'tq', workflowName: 'reviewContent' });
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('summarizes oversized stream message payloads to {bytes,preview,truncated}', async () => {
    mockExport.mockResolvedValue({ events: [] });
    const big = 'x'.repeat(5000);
    mockStream.mockResolvedValue({
      messages: [{ id: 'm1', source: 'worker', message: big, dead_lettered_at: null, reserved_at: null, expired_at: null }],
    });

    const d = await diagnoseJob('wf-1', 'durable', { include: ['streams'] });
    const summarized = d.stream_messages!.worker[0].message as { bytes: number; preview: string; truncated: true };
    expect(summarized.truncated).toBe(true);
    expect(summarized.bytes).toBe(5000);
    expect(summarized.preview.length).toBe(200);
  });

  it('summarizes oversized result strings inside event attributes', async () => {
    const big = 'y'.repeat(5000);
    mockStream.mockResolvedValue({ messages: [] });
    mockExport.mockResolvedValue({
      events: [{ event_id: 1, event_type: 'activity_task_completed', event_time: new Date().toISOString(), attributes: { result: big } }],
    });

    const d = await diagnoseJob('wf-1', 'durable', { include: ['events'] });
    const attrs = (d.execution_events![0] as { attributes: { result: { truncated: boolean; bytes: number } } }).attributes;
    expect(attrs.result.truncated).toBe(true);
    expect(attrs.result.bytes).toBe(5000);
  });
});
