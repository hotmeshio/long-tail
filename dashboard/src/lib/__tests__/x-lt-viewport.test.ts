import { describe, it, expect } from 'vitest';
import {
  VIEWPORT_STAGES,
  expandViewportSrc,
  readViewport,
  viewportSrcForStage,
  viewportStage,
  type XLtViewport,
} from '../x-lt-viewport';
import type { LTEscalationRecord } from '../../api/types';

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

const viewport: XLtViewport = {
  type: 'iframe',
  src: 'http://example.com/design?id={workbenchId}',
  onPending: 'http://example.com/preview?id={workbenchId}',
  onResolved: 'http://example.com/summary?stl={stl_url}',
};

describe('expandViewportSrc', () => {
  it('returns src unchanged when no tokens present', () => {
    expect(expandViewportSrc('http://localhost:3016/', base())).toBe('http://localhost:3016/');
  });

  it('replaces tokens from escalation_payload', () => {
    const esc = base({ escalation_payload: JSON.stringify({ workbenchId: 'wb-1', companyId: 'co-1' }) });
    expect(expandViewportSrc('http://x/design?workbenchId={workbenchId}&companyId={companyId}', esc))
      .toBe('http://x/design?workbenchId=wb-1&companyId=co-1');
  });

  it('replaces tokens from metadata (already-parsed object)', () => {
    const esc = base({ metadata: { workbenchId: 'wb-meta' } });
    expect(expandViewportSrc('http://x/?id={workbenchId}', esc)).toBe('http://x/?id=wb-meta');
  });

  it('escalation_payload wins over metadata; resolver_payload wins over both', () => {
    const esc = base({
      metadata: { workbenchId: 'from-meta' },
      escalation_payload: JSON.stringify({ workbenchId: 'from-payload' }),
    });
    expect(expandViewportSrc('http://x/?id={workbenchId}', esc)).toBe('http://x/?id=from-payload');
    const resolved = base({
      escalation_payload: JSON.stringify({ stl_url: 'draft' }),
      resolver_payload: JSON.stringify({ stl_url: 's3://final.stl' }),
    });
    expect(expandViewportSrc('http://x/?stl={stl_url}', resolved)).toBe('http://x/?stl=s3://final.stl');
  });

  it('replaces tokens from envelope string', () => {
    const esc = base({ envelope: JSON.stringify({ sessionId: 'sess-42' }) });
    expect(expandViewportSrc('http://x/?s={sessionId}', esc)).toBe('http://x/?s=sess-42');
  });

  it('leaves unmatched tokens in place', () => {
    const esc = base({ escalation_payload: JSON.stringify({ workbenchId: 'wb-1' }) });
    expect(expandViewportSrc('http://x/?a={workbenchId}&b={missing}', esc)).toBe('http://x/?a=wb-1&b={missing}');
  });

  it('returns src unchanged when sources are null or malformed', () => {
    expect(expandViewportSrc('http://x/?id={workbenchId}', base())).toBe('http://x/?id={workbenchId}');
    expect(expandViewportSrc('http://x/?id={workbenchId}', base({ escalation_payload: '{not-json' })))
      .toBe('http://x/?id={workbenchId}');
  });
});

describe('readViewport', () => {
  it('accepts only an iframe declaration with a src', () => {
    expect(readViewport({ 'x-lt-viewport': viewport })).toEqual(viewport);
    expect(readViewport({ 'x-lt-viewport': { type: 'iframe' } })).toBeNull();
    expect(readViewport({ 'x-lt-viewport': { type: 'other', src: 'x' } })).toBeNull();
    expect(readViewport({})).toBeNull();
    expect(readViewport(null)).toBeNull();
  });
});

describe('viewportStage', () => {
  it('maps status and editability to a stage', () => {
    expect(viewportStage(base(), false)).toBe(VIEWPORT_STAGES.PENDING);
    expect(viewportStage(base(), true)).toBe(VIEWPORT_STAGES.CLAIMED);
    expect(viewportStage(base({ status: 'resolved' }), false)).toBe(VIEWPORT_STAGES.RESOLVED);
    expect(viewportStage(base({ status: 'cancelled' }), false)).toBeNull();
  });
});

describe('viewportSrcForStage', () => {
  it('claimed is src; pending and resolved read their optional URLs', () => {
    expect(viewportSrcForStage(viewport, VIEWPORT_STAGES.CLAIMED)).toBe(viewport.src);
    expect(viewportSrcForStage(viewport, VIEWPORT_STAGES.PENDING)).toBe(viewport.onPending);
    expect(viewportSrcForStage(viewport, VIEWPORT_STAGES.RESOLVED)).toBe(viewport.onResolved);
  });

  it('an undeclared stage yields null so the default surface renders', () => {
    const bare: XLtViewport = { type: 'iframe', src: viewport.src };
    expect(viewportSrcForStage(bare, VIEWPORT_STAGES.PENDING)).toBeNull();
    expect(viewportSrcForStage(bare, VIEWPORT_STAGES.RESOLVED)).toBeNull();
  });
});
