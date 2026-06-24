import { describe, it, expect } from 'vitest';

import { matchPatterns } from '../../../services/diagnostics/patterns';
import type { StreamMessage } from '../../../services/controlplane/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_EXECUTION = {
  workflow_id: 'wf-test-1',
  summary: { total_events: 0, total_duration_ms: null, activity_count: 0 },
  status: 1,
  result: null,
  timeline: [],
  transitions: [],
  parent_workflow_id: undefined,
};

function makeWorkerMsg(overrides: Partial<StreamMessage> = {}): StreamMessage {
  return {
    id: 'msg-1',
    source: 'worker',
    stream_name: 'default-activity',
    message: JSON.stringify({ data: { signalId: 'sig-123', queueConfig: null } }),
    status: 'processed',
    created_at: new Date(Date.now() - 5000).toISOString(),
    reserved_at: new Date(Date.now() - 4000).toISOString(),
    reserved_by: 'engine-1',
    expired_at: new Date(Date.now() - 3000).toISOString(),
    dead_lettered_at: null,
    priority: 0,
    visible_at: null,
    retry_attempt: 0,
    max_retry_attempts: 3,
    workflow_name: 'reviewContent',
    jid: 'wf-test-1',
    aid: '0/0/0/worker',
    dad: null,
    msg_type: null,
    topic: 'default-activity',
    ...overrides,
  };
}

function makeSignalWaitStarted(timelineKey = 'wait-1') {
  return {
    event_id: 2,
    event_type: 'signal_wait_started' as const,
    category: 'signal' as const,
    event_time: new Date(Date.now() - 3000).toISOString(),
    duration_ms: null,
    is_system: false,
    attributes: { kind: 'signal_wait_started', timeline_key: timelineKey },
  };
}

function makeSignalCompleted(timelineKey = 'wait-1') {
  return {
    event_id: 3,
    event_type: 'workflow_execution_signaled' as const,
    category: 'signal' as const,
    event_time: new Date(Date.now() - 1000).toISOString(),
    duration_ms: 2000,
    is_system: false,
    attributes: { timeline_key: timelineKey, signal_name: 'review-sig-123' },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('matchPatterns', () => {

  describe('orphaned_signal', () => {
    it('detects open signal with no escalation row', () => {
      const execution = {
        ...BASE_EXECUTION,
        events: [makeSignalWaitStarted()],
      };
      const findings = matchPatterns(execution as any, [makeWorkerMsg()], [], null);
      const f = findings.find(f => f.condition === 'orphaned_signal');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('critical');
      expect(f!.confidence).toBeGreaterThan(0.95);
      expect(f!.evidence.some(e => e.includes('No escalation row'))).toBe(true);
    });

    it('includes missing_queue_config evidence when queueConfig is absent', () => {
      const execution = { ...BASE_EXECUTION, events: [makeSignalWaitStarted()] };
      const workerMsg = makeWorkerMsg({
        message: JSON.stringify({ data: { signalId: 'sig-abc', queueConfig: null } }),
      });
      const findings = matchPatterns(execution as any, [workerMsg], [], null);
      const f = findings.find(f => f.condition === 'orphaned_signal')!;
      expect(f.evidence.some(e => e.includes('missing queueConfig'))).toBe(true);
    });

    it('gives read-only guidance (inspect + escalate, no mutation) referencing the signal', () => {
      const execution = { ...BASE_EXECUTION, events: [makeSignalWaitStarted()] };
      const workerMsg = makeWorkerMsg({
        message: JSON.stringify({ data: { signalId: 'sig-xyz', queueConfig: null } }),
      });
      const findings = matchPatterns(execution as any, [workerMsg], [], null);
      const f = findings.find(f => f.condition === 'orphaned_signal')!;

      const inspect = f.guidance.find(g => g.action === 'inspect_worker_result');
      expect(inspect).toBeDefined();
      expect(inspect!.note).toContain('sig-xyz');

      expect(f.guidance.some(g => g.action === 'escalate_to_engineering')).toBe(true);
      // No recovery/mutation actions are ever prescribed.
      expect(f.guidance.some(g => g.action === 'create_escalation_row' || g.action === 'resolve_by_signal_key')).toBe(false);
    });
  });

  describe('normal_wait', () => {
    it('detects open signal with pending escalation row', () => {
      const execution = { ...BASE_EXECUTION, events: [makeSignalWaitStarted()] };
      const escalation = { id: 'esc-1', status: 'pending', role: 'reviewer', type: 'content-review' };
      const findings = matchPatterns(execution as any, [], [], escalation as any);
      const f = findings.find(f => f.condition === 'normal_wait');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('info');
    });

    it('does not fire when signal is already resolved', () => {
      const execution = {
        ...BASE_EXECUTION,
        events: [makeSignalWaitStarted(), makeSignalCompleted()],
      };
      const escalation = { id: 'esc-1', status: 'resolved', role: 'reviewer', type: 'content-review' };
      const findings = matchPatterns(execution as any, [], [], escalation as any);
      expect(findings.find(f => f.condition === 'normal_wait')).toBeUndefined();
      expect(findings.find(f => f.condition === 'orphaned_signal')).toBeUndefined();
    });
  });

  describe('dead_lettered_activity', () => {
    it('detects dead-lettered worker messages', () => {
      const execution = { ...BASE_EXECUTION, events: [] };
      const deadMsg = makeWorkerMsg({
        dead_lettered_at: new Date().toISOString(),
        expired_at: null,
        status: 'dead_lettered',
      });
      const findings = matchPatterns(execution as any, [deadMsg], [], null);
      const f = findings.find(f => f.condition === 'dead_lettered_activity');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('critical');
      expect(f!.evidence[0]).toContain('1 worker message');
    });

    it('detects dead-lettered engine messages', () => {
      const execution = { ...BASE_EXECUTION, events: [] };
      const deadEngine: StreamMessage = {
        ...makeWorkerMsg(),
        source: 'engine',
        aid: null,
        dead_lettered_at: new Date().toISOString(),
        expired_at: null,
        status: 'dead_lettered',
      };
      const findings = matchPatterns(execution as any, [], [deadEngine], null);
      const f = findings.find(f => f.condition === 'dead_lettered_activity');
      expect(f).toBeDefined();
      expect(f!.evidence[0]).toContain('1 engine message');
    });
  });

  describe('reservation_leak', () => {
    it('detects message claimed but not ACKd for over 30s', () => {
      const execution = { ...BASE_EXECUTION, events: [] };
      const leakyMsg = makeWorkerMsg({
        reserved_at: new Date(Date.now() - 60_000).toISOString(),
        expired_at: null,
        dead_lettered_at: null,
        status: 'claimed',
      });
      const findings = matchPatterns(execution as any, [leakyMsg], [], null);
      const f = findings.find(f => f.condition === 'reservation_leak');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
    });

    it('does not fire for recently claimed messages', () => {
      const execution = { ...BASE_EXECUTION, events: [] };
      const freshMsg = makeWorkerMsg({
        reserved_at: new Date(Date.now() - 5_000).toISOString(),
        expired_at: null,
        dead_lettered_at: null,
        status: 'claimed',
      });
      const findings = matchPatterns(execution as any, [freshMsg], [], null);
      expect(findings.find(f => f.condition === 'reservation_leak')).toBeUndefined();
    });
  });

  describe('terminal_failure', () => {
    it('detects workflow_execution_failed as last event', () => {
      const execution = {
        ...BASE_EXECUTION,
        events: [
          { event_id: 1, event_type: 'workflow_execution_started', category: 'workflow', event_time: new Date().toISOString(), duration_ms: null, is_system: false, attributes: {} },
          { event_id: 2, event_type: 'workflow_execution_failed', category: 'workflow', event_time: new Date().toISOString(), duration_ms: null, is_system: false, attributes: { error: 'timeout' } },
        ],
      };
      const findings = matchPatterns(execution as any, [], [], null);
      const f = findings.find(f => f.condition === 'terminal_failure');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('critical');
      expect(f!.evidence.some(e => e.includes('timeout'))).toBe(true);
    });
  });

  describe('never_started', () => {
    it('detects workflow with only the started event', () => {
      const execution = {
        ...BASE_EXECUTION,
        events: [
          { event_id: 1, event_type: 'workflow_execution_started', category: 'workflow', event_time: new Date().toISOString(), duration_ms: null, is_system: false, attributes: {} },
        ],
      };
      const findings = matchPatterns(execution as any, [], [], null);
      const f = findings.find(f => f.condition === 'never_started');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('critical');
    });
  });

  describe('healthy defaults', () => {
    it('returns completed when workflow_execution_completed is present', () => {
      const execution = {
        ...BASE_EXECUTION,
        events: [
          { event_id: 1, event_type: 'workflow_execution_started', category: 'workflow', event_time: new Date().toISOString(), duration_ms: null, is_system: false, attributes: {} },
          { event_id: 2, event_type: 'workflow_execution_completed', category: 'workflow', event_time: new Date().toISOString(), duration_ms: 500, is_system: false, attributes: {} },
        ],
      };
      const findings = matchPatterns(execution as any, [], [], null);
      expect(findings[0].condition).toBe('completed');
      expect(findings[0].severity).toBe('info');
    });

    it('returns running when no terminal event and no anomalies', () => {
      const execution = {
        ...BASE_EXECUTION,
        events: [
          { event_id: 1, event_type: 'workflow_execution_started', category: 'workflow', event_time: new Date().toISOString(), duration_ms: null, is_system: false, attributes: {} },
          { event_id: 2, event_type: 'activity_task_completed', category: 'activity', event_time: new Date().toISOString(), duration_ms: 100, is_system: false, attributes: {} },
        ],
      };
      const findings = matchPatterns(execution as any, [], [], null);
      expect(findings[0].condition).toBe('running');
    });
  });

  describe('finding ordering', () => {
    it('orders critical findings before info', () => {
      const execution = { ...BASE_EXECUTION, events: [makeSignalWaitStarted()] };
      const findings = matchPatterns(execution as any, [], [], null);
      const severities = findings.map(f => f.severity);
      for (let i = 1; i < severities.length; i++) {
        const order = { critical: 0, warning: 1, info: 2 };
        expect(order[severities[i - 1]]).toBeLessThanOrEqual(order[severities[i]]);
      }
    });
  });
});
