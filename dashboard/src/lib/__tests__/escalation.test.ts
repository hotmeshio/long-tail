import { describe, it, expect } from 'vitest';
import { isEffectivelyClaimed, isAvailable } from '../escalation';
import type { LTEscalationRecord } from '../../api/types';

function makeEsc(overrides: Partial<LTEscalationRecord> = {}): LTEscalationRecord {
  return {
    id: '1',
    type: 'review',
    subtype: 'content',
    modality: 'portal',
    description: null,
    status: 'pending',
    priority: 2,
    task_id: null,
    origin_id: null,
    parent_id: null,
    workflow_id: null,
    task_queue: null,
    workflow_type: null,
    role: 'reviewer',
    assigned_to: null,
    assigned_until: null,
    resolved_at: null,
    claimed_at: null,
    envelope: '{}',
    metadata: null,
    escalation_payload: null,
    resolver_payload: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    trace_id: null,
    span_id: null,
    ...overrides,
  };
}

describe('isEffectivelyClaimed', () => {
  it('returns false when not assigned', () => {
    expect(isEffectivelyClaimed(makeEsc())).toBe(false);
  });

  it('returns false when assignment expired', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isEffectivelyClaimed(makeEsc({
      assigned_to: 'user-1',
      assigned_until: past,
    }))).toBe(false);
  });

  it('returns true when actively claimed', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isEffectivelyClaimed(makeEsc({
      assigned_to: 'user-1',
      assigned_until: future,
    }))).toBe(true);
  });
});

describe('isAvailable', () => {
  it('returns true when pending and unassigned', () => {
    expect(isAvailable(makeEsc())).toBe(true);
  });

  it('returns false when resolved', () => {
    expect(isAvailable(makeEsc({ status: 'resolved' }))).toBe(false);
  });

  it('returns true when assignment has expired', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isAvailable(makeEsc({
      assigned_to: 'user-1',
      assigned_until: past,
    }))).toBe(true);
  });

  it('returns false when actively claimed', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isAvailable(makeEsc({
      assigned_to: 'user-1',
      assigned_until: future,
    }))).toBe(false);
  });
});
