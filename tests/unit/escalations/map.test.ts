import { describe, it, expect } from 'vitest';

import {
  toEscalationRecord,
  toEscalationRecords,
  toJsonObject,
  toEnvelopeObject,
} from '../../../services/escalation/map';

// Minimal SDK EscalationEntry — only the fields the mapper reads.
function makeEntry(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-1',
    type: 'orderPipeline',
    subtype: 'qc',
    description: 'inspect',
    status: 'pending',
    priority: 2,
    task_id: null,
    origin_id: null,
    parent_id: null,
    workflow_id: 'wf-1',
    task_queue: 'order-pipeline',
    workflow_type: 'efficientStation',
    signal_key: 'station-done-wf-1',
    role: 'operator',
    assigned_to: null,
    assigned_until: null,
    resolved_at: null,
    claimed_at: null,
    envelope: { instructions: 'go' },
    metadata: { station: 'qc' },
    escalation_payload: { foo: 'bar' },
    resolver_payload: null,
    trace_id: null,
    span_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('toEscalationRecord', () => {
  it('carries signal_key (the efficient resume key) through to the public record', () => {
    const rec = toEscalationRecord(makeEntry());
    expect(rec.signal_key).toBe('station-done-wf-1');
  });

  it('preserves a null signal_key for service-created rows', () => {
    const rec = toEscalationRecord(makeEntry({ signal_key: null }));
    expect(rec.signal_key).toBeNull();
  });

  it('serializes JSONB envelope and payload columns to JSON strings', () => {
    const rec = toEscalationRecord(makeEntry());
    expect(rec.envelope).toBe('{"instructions":"go"}');
    expect(rec.escalation_payload).toBe('{"foo":"bar"}');
    expect(rec.resolver_payload).toBeNull();
  });

  it('defaults a null envelope to "{}" and nullable classification to empty strings', () => {
    const rec = toEscalationRecord(makeEntry({ envelope: null, type: null, subtype: null, role: null }));
    expect(rec.envelope).toBe('{}');
    expect(rec.type).toBe('');
    expect(rec.subtype).toBe('');
    expect(rec.role).toBe('');
  });

  it('maps a list', () => {
    const recs = toEscalationRecords([makeEntry(), makeEntry({ id: 'esc-2', signal_key: null })]);
    expect(recs).toHaveLength(2);
    expect(recs[1].signal_key).toBeNull();
  });
});

describe('toJsonObject / toEnvelopeObject', () => {
  it('parses a JSON string into an object', () => {
    expect(toJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns undefined for empty/invalid input (column stays NULL)', () => {
    expect(toJsonObject('')).toBeUndefined();
    expect(toJsonObject(null)).toBeUndefined();
    expect(toJsonObject('not json')).toBeUndefined();
  });

  it('toEnvelopeObject always yields an object, defaulting to {}', () => {
    expect(toEnvelopeObject(null)).toEqual({});
    expect(toEnvelopeObject('{"x":2}')).toEqual({ x: 2 });
  });
});
