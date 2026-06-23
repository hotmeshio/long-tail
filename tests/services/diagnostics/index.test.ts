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

  it('caps execution_events to the most recent maxEvents and flags truncation', async () => {
    mockExport.mockResolvedValue({ events: makeEvents(600) });

    const d = await diagnoseJob('wf-1', 'durable', { maxEvents: 500 });
    expect(d.total_events).toBe(600);
    expect(d.events_truncated).toBe(true);
    expect(d.execution_events).toHaveLength(500);
  });

  it('does not truncate when events fit under the cap', async () => {
    mockExport.mockResolvedValue({ events: makeEvents(10) });

    const d = await diagnoseJob('wf-1', 'durable', { maxEvents: 500 });
    expect(d.total_events).toBe(10);
    expect(d.events_truncated).toBe(false);
    expect(d.execution_events).toHaveLength(10);
  });
});
