import { describe, it, expect } from 'vitest';
import { expandViewportSrc } from '../EscalationDetailSections';
import type { LTEscalationRecord } from '../../../api/types';

function base(overrides: Partial<LTEscalationRecord> = {}): LTEscalationRecord {
  return {
    id: 'esc-1',
    type: 'cad',
    subtype: 'insole-design',
    description: null,
    status: 'pending',
    priority: 2,
    task_id: null,
    origin_id: null,
    parent_id: null,
    workflow_id: null,
    task_queue: null,
    workflow_type: null,
    role: 'cad-designer',
    assigned_to: null,
    assigned_until: null,
    resolved_at: null,
    claimed_at: null,
    envelope: '{}',
    metadata: null,
    escalation_payload: null,
    resolver_payload: null,
    trace_id: null,
    span_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('expandViewportSrc', () => {
  it('returns src unchanged when no tokens present', () => {
    const esc = base();
    expect(expandViewportSrc('http://localhost:3016/', esc)).toBe('http://localhost:3016/');
  });

  it('replaces tokens from escalation_payload', () => {
    const esc = base({
      escalation_payload: JSON.stringify({ workbenchId: 'wb-1', companyId: 'co-1' }),
    });
    const result = expandViewportSrc(
      'http://localhost:3016/design?workbenchId={workbenchId}&companyId={companyId}',
      esc,
    );
    expect(result).toBe('http://localhost:3016/design?workbenchId=wb-1&companyId=co-1');
  });

  it('replaces tokens from metadata (already-parsed object)', () => {
    const esc = base({
      metadata: { workbenchId: 'wb-meta', companyId: 'co-meta' },
    });
    const result = expandViewportSrc(
      'http://localhost:3016/design?workbenchId={workbenchId}&companyId={companyId}',
      esc,
    );
    expect(result).toBe('http://localhost:3016/design?workbenchId=wb-meta&companyId=co-meta');
  });

  it('escalation_payload wins over metadata for the same key', () => {
    const esc = base({
      metadata: { workbenchId: 'from-meta' },
      escalation_payload: JSON.stringify({ workbenchId: 'from-payload' }),
    });
    expect(expandViewportSrc('http://example.com/?id={workbenchId}', esc))
      .toBe('http://example.com/?id=from-payload');
  });

  it('replaces tokens from envelope string', () => {
    const esc = base({ envelope: JSON.stringify({ sessionId: 'sess-42' }) });
    expect(expandViewportSrc('http://example.com/?s={sessionId}', esc))
      .toBe('http://example.com/?s=sess-42');
  });

  it('leaves unmatched tokens in place', () => {
    const esc = base({ escalation_payload: JSON.stringify({ workbenchId: 'wb-1' }) });
    const result = expandViewportSrc('http://example.com/?a={workbenchId}&b={missing}', esc);
    expect(result).toBe('http://example.com/?a=wb-1&b={missing}');
  });

  it('returns src unchanged when all sources are null', () => {
    const esc = base();
    expect(expandViewportSrc('http://example.com/?id={workbenchId}', esc))
      .toBe('http://example.com/?id={workbenchId}');
  });

  it('returns src unchanged when escalation_payload is malformed JSON', () => {
    const esc = base({ escalation_payload: '{not-json' });
    expect(expandViewportSrc('http://example.com/?id={workbenchId}', esc))
      .toBe('http://example.com/?id={workbenchId}');
  });
});
