import { describe, it, expect } from 'vitest';
import { mapSystemEvent } from '../../../lib/events/system-events';
import type { Types } from '@hotmeshio/hotmesh';

function makeEscalationEvent(overrides: Partial<Types.SystemEvent> = {}): Types.SystemEvent {
  return {
    event_id: 'esc-1:created:2026-07-25T00:00:00.000Z',
    type: 'system.escalation.esc-1.created',
    ts: '2026-07-25T00:00:00.000Z',
    namespace: 'long-tail',
    app_id: 'long-tail',
    workflow_id: 'wf-1',
    data: {
      id: 'esc-1',
      role: 'qc_inspector',
      workflow_id: 'wf-1',
      workflow_type: 'efficientStation',
      task_queue: 'factory',
      origin_id: 'origin-1',
    },
    ...overrides,
  } as Types.SystemEvent;
}

describe('mapSystemEvent', () => {
  it('rewrites SDK escalation subjects onto the role-bearing shape', () => {
    const mapped = mapSystemEvent(makeEscalationEvent());
    expect(mapped.type).toBe('system.escalation.qc_inspector.esc-1.created');
    expect(mapped.role).toBe('qc_inspector');
    expect(mapped.escalationId).toBe('esc-1');
    expect(mapped.status).toBe('pending');
    expect(mapped.workflowName).toBe('efficientStation');
  });

  it('sanitizes an unsafe role into a single subject token', () => {
    const mapped = mapSystemEvent(makeEscalationEvent({
      type: 'system.escalation.esc-2.created',
      data: { id: 'esc-2', role: 'weird role.here' },
    } as Partial<Types.SystemEvent>));
    expect(mapped.type).toBe('system.escalation.weird-role-here.esc-2.created');
    expect(mapped.role).toBe('weird role.here');
  });

  it('a row without a role publishes under the "none" token', () => {
    const mapped = mapSystemEvent(makeEscalationEvent({
      type: 'system.escalation.esc-3.created',
      data: { id: 'esc-3' },
    } as Partial<Types.SystemEvent>));
    expect(mapped.type).toBe('system.escalation.none.esc-3.created');
    expect(mapped.role).toBeUndefined();
  });

  it('keeps the verb from the SDK subject', () => {
    const mapped = mapSystemEvent(makeEscalationEvent({
      type: 'system.escalation.esc-1.expired',
    } as Partial<Types.SystemEvent>));
    expect(mapped.type).toBe('system.escalation.qc_inspector.esc-1.expired');
    expect(mapped.status).toBe('expired');
  });

  it('non-escalation events pass through with their canonical type', () => {
    const mapped = mapSystemEvent({
      event_id: 'e-1',
      type: 'system.engine.started',
      ts: '2026-07-25T00:00:00.000Z',
      namespace: 'long-tail',
      app_id: 'long-tail',
      data: { taskQueue: 'factory' },
    } as Types.SystemEvent);
    expect(mapped.type).toBe('system.engine.started');
    expect(mapped.role).toBeUndefined();
  });
});
