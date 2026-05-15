import { describe, it, expect } from 'vitest';
import { applyInputMapping } from '../../../services/agent/input-mapper';
import type { LTEvent } from '../../../types';

const baseEvent: LTEvent = {
  type: 'workflow.failed',
  source: 'interceptor',
  workflowId: 'wf-123',
  workflowName: 'myWorkflow',
  taskQueue: 'my-queue',
  status: 'failed',
  data: { orderId: 'ORD-001', error: 'timeout', nested: { field: 'deep' } },
  timestamp: '2026-05-15T00:00:00Z',
};

describe('applyInputMapping', () => {
  it('resolves simple top-level event fields', () => {
    const mapping = { source: '{event.source}', wfId: '{event.workflowId}' };
    const result = applyInputMapping(mapping, baseEvent);
    expect(result).toEqual({ source: 'interceptor', wfId: 'wf-123' });
  });

  it('resolves nested event.data fields', () => {
    const mapping = { data: { orderId: '{event.data.orderId}', err: '{event.data.error}' } };
    const result = applyInputMapping(mapping, baseEvent);
    expect(result).toEqual({ data: { orderId: 'ORD-001', err: 'timeout' } });
  });

  it('resolves deeply nested paths', () => {
    const mapping = { deep: '{event.data.nested.field}' };
    const result = applyInputMapping(mapping, baseEvent);
    expect(result).toEqual({ deep: 'deep' });
  });

  it('passes through non-template strings', () => {
    const mapping = { static: 'hello', mixed: 'prefix-{event.source}' };
    const result = applyInputMapping(mapping, baseEvent);
    // Only exact {path} templates resolve; partial templates stay as-is
    expect(result.static).toBe('hello');
    expect(result.mixed).toBe('prefix-{event.source}');
  });

  it('passes through non-string values (numbers, booleans, null)', () => {
    const mapping = { count: 42, flag: true, empty: null };
    const result = applyInputMapping(mapping, baseEvent);
    expect(result).toEqual({ count: 42, flag: true, empty: null });
  });

  it('returns raw template when path does not exist', () => {
    const mapping = { missing: '{event.data.nonexistent}' };
    const result = applyInputMapping(mapping, baseEvent);
    expect(result.missing).toBe('{event.data.nonexistent}');
  });

  it('handles empty mapping', () => {
    const result = applyInputMapping({}, baseEvent);
    expect(result).toEqual({});
  });

  it('handles nested objects recursively', () => {
    const mapping = {
      metadata: { source: 'agent', certified: true },
      data: { id: '{event.workflowId}' },
    };
    const result = applyInputMapping(mapping, baseEvent);
    expect(result.metadata).toEqual({ source: 'agent', certified: true });
    expect(result.data).toEqual({ id: 'wf-123' });
  });
});
