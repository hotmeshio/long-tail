import { describe, it, expect } from 'vitest';
import { projectEscalationRow, escalationEventData } from '../../../lib/events/escalation-wire';

const fullRow = {
  id: 'esc-1',
  type: 'form',
  subtype: 'intake',
  status: 'resolved',
  priority: 2,
  role: 'intake-reviewer',
  assigned_to: 'user-7',
  workflow_id: 'wf-1',
  // heavy/sensitive JSON columns — must never ride the wire
  envelope: { big: 'x'.repeat(500) },
  escalation_payload: { initial: 'y'.repeat(500) },
  resolver_payload: { mandate: 'z'.repeat(500) },
  metadata: {
    orderId: 'ORD-9',
    serialNumber: 'PRN-001',
    schema_version: 3,
    form_schema: { type: 'object', properties: { huge: {} } },
  },
};

describe('projectEscalationRow — the one wire shape', () => {
  it('drops the heavy/sensitive JSON columns', () => {
    const out = projectEscalationRow(fullRow);
    expect(out.envelope).toBeUndefined();
    expect(out.escalation_payload).toBeUndefined();
    expect(out.resolver_payload).toBeUndefined();
  });

  it('keeps scalar routing/classification columns', () => {
    const out = projectEscalationRow(fullRow);
    expect(out).toMatchObject({
      id: 'esc-1', type: 'form', subtype: 'intake', status: 'resolved',
      priority: 2, role: 'intake-reviewer', assigned_to: 'user-7', workflow_id: 'wf-1',
    });
  });

  it('keeps metadata facets but strips the embedded form_schema', () => {
    const out = projectEscalationRow(fullRow);
    expect(out.metadata).toEqual({ orderId: 'ORD-9', serialNumber: 'PRN-001', schema_version: 3 });
  });

  it('handles a null / absent metadata bag', () => {
    expect(projectEscalationRow({ id: 'e', metadata: null }).metadata).toBeUndefined();
    expect(projectEscalationRow({ id: 'e' }).metadata).toBeUndefined();
  });

  it('projects only the columns present (partial rows from lean RETURNING)', () => {
    const out = projectEscalationRow({ id: 'e', role: 'r', workflow_id: 'wf' });
    expect(out).toEqual({ id: 'e', role: 'r', workflow_id: 'wf' });
  });
});

describe('escalationEventData — projection + verb provenance', () => {
  it('merges verb context alongside the projection', () => {
    const out = escalationEventData(fullRow, { resolved_by: 'user-7' });
    expect(out.resolved_by).toBe('user-7');
    expect(out.type).toBe('form');
    expect(out.envelope).toBeUndefined();
    expect(out.metadata.form_schema).toBeUndefined();
  });

  it('is the projection alone when no context is given', () => {
    expect(escalationEventData(fullRow)).toEqual(projectEscalationRow(fullRow));
  });
});
