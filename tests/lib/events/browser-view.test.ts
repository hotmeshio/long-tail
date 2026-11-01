import { describe, it, expect } from 'vitest';

import { eventForViewer, payloadForViewer, viewerFor } from '../../../lib/events/browser-view';
import type { LTEvent } from '../../../types';

const escalation: LTEvent = {
  type: 'system.escalation.finance.esc-1.created',
  timestamp: 't',
  escalationId: 'esc-1',
  role: 'finance',
  data: {
    id: 'esc-1', role: 'finance', status: 'pending', assigned_to: 'u-1', parent_id: 'p-1',
    description: 'Refund for patient 4411', signal_key: 'sk', metadata: { orderId: 'A-1' },
  },
};
const milestone: LTEvent = {
  type: 'system.milestone.wf-1', timestamp: 't', workflowId: 'wf-1',
  milestones: [{ name: 'ai_review', value: 'approved' }] as any, data: { result: 'secret' },
};

describe('eventForViewer', () => {
  it('a builder receives events whole', () => {
    expect(eventForViewer(escalation, { builder: true })).toBe(escalation);
    expect(eventForViewer(milestone, { builder: true })).toBe(milestone);
  });

  it('escalation events keep only routing fields for anyone else', () => {
    const seen = eventForViewer(escalation, { builder: false });
    expect(seen.data).toEqual({ id: 'esc-1', role: 'finance', status: 'pending', assigned_to: 'u-1', parent_id: 'p-1' });
    expect(seen).toMatchObject({ type: escalation.type, escalationId: 'esc-1', role: 'finance' });
  });

  it('every other event arrives without data and milestones', () => {
    const seen = eventForViewer(milestone, { builder: false });
    expect(seen).toEqual({ type: 'system.milestone.wf-1', timestamp: 't', workflowId: 'wf-1' });
  });
});

describe('machine wire events', () => {
  const wire: LTEvent = {
    type: 'machine.wire.site-1.line-1.press-01.in', timestamp: 't', source: 'machine-gateway',
    data: {
      type: 'machine.wire', siteId: 'site-1', lineId: 'line-1', machineId: 'press-01', direction: 'in', kind: 'job', event: 'arrived',
      summary: 'job arrived U1', violations: [], actions: [{ verb: 'accumulate', rowId: 'h1', itemKey: 'arrived:U1' }],
      payload: { v: '1', body: { event: 'arrived', unitId: 'U1', measurements: [{ name: 'secret', value: 1 }] } },
    },
  };

  it('a builder receives the raw payload', () => {
    expect(eventForViewer(wire, { builder: true })).toBe(wire);
  });

  it('anyone else receives the record without the payload', () => {
    const seen = eventForViewer(wire, { builder: false });
    expect(seen.data).not.toHaveProperty('payload');
    expect(seen.data).toMatchObject({ kind: 'job', event: 'arrived', summary: 'job arrived U1', actions: [{ verb: 'accumulate', rowId: 'h1', itemKey: 'arrived:U1' }] });
    expect(seen.type).toBe(wire.type);
  });
});

describe('payloadForViewer', () => {
  it('rewrites a serialized event, and withholds anything that is not one', () => {
    const out = payloadForViewer(Buffer.from(JSON.stringify(milestone)), { builder: false })!;
    expect(JSON.parse(out.toString())).not.toHaveProperty('data');
    expect(payloadForViewer(Buffer.from('not json'), { builder: false })).toBeNull();
    expect(payloadForViewer(Buffer.from('{"no":"type"}'), { builder: false })).toBeNull();
    const raw = Buffer.from('anything');
    expect(payloadForViewer(raw, { builder: true })).toBe(raw);
  });

  it('no person is never a builder', async () => {
    expect(await viewerFor(null)).toEqual({ builder: false });
  });
});
