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

  it('forwards the born-assigned marker (envelope) and parent_id (row/data)', () => {
    const mapped = mapSystemEvent(makeEscalationEvent({
      type: 'system.escalation.esc-1.claimed',
      assigned_at_creation: true,
      data: { id: 'esc-1', role: 'qc_inspector', assigned_to: 'user-7', parent_id: 'esc-0' },
    } as Partial<Types.SystemEvent>));
    expect(mapped.type).toBe('system.escalation.qc_inspector.esc-1.claimed');
    expect(mapped.status).toBe('claimed');
    expect(mapped.assignedAtCreation).toBe(true);
    expect((mapped.data as any).assigned_to).toBe('user-7');
    expect((mapped.data as any).parent_id).toBe('esc-0');
  });

  it('leaves the marker undefined for an interactive claim (no envelope flag)', () => {
    const mapped = mapSystemEvent(makeEscalationEvent({
      type: 'system.escalation.esc-1.claimed',
      data: { id: 'esc-1', role: 'qc_inspector', assigned_to: 'user-7' },
    } as Partial<Types.SystemEvent>));
    expect(mapped.assignedAtCreation).toBeUndefined();
  });

  it('drops the heavy/sensitive JSON columns from the wire data', () => {
    const mapped = mapSystemEvent(makeEscalationEvent({
      type: 'system.escalation.esc-1.resolved',
      data: {
        id: 'esc-1',
        role: 'qc_inspector',
        status: 'resolved',
        envelope: '{"big":"envelope"}',
        escalation_payload: '{"initial":"payload"}',
        resolver_payload: '{"mandate":"gcode…"}',
      },
    } as Partial<Types.SystemEvent>));
    const data = mapped.data as Record<string, any>;
    expect(data.envelope).toBeUndefined();
    expect(data.escalation_payload).toBeUndefined();
    expect(data.resolver_payload).toBeUndefined();
    // Routing/classification scalars survive.
    expect(data.id).toBe('esc-1');
    expect(data.status).toBe('resolved');
  });

  it('keeps metadata routing facets but strips an embedded form_schema', () => {
    const mapped = mapSystemEvent(makeEscalationEvent({
      data: {
        id: 'esc-1',
        role: 'qc_inspector',
        metadata: {
          orderId: 'ORD-9',
          serialNumber: 'PRN-001',
          schema_version: 3,
          form_schema: { type: 'object', properties: { huge: {} } },
        },
      },
    } as Partial<Types.SystemEvent>));
    const md = (mapped.data as Record<string, any>).metadata;
    expect(md.orderId).toBe('ORD-9');
    expect(md.serialNumber).toBe('PRN-001');
    expect(md.schema_version).toBe(3);
    expect(md.form_schema).toBeUndefined();
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
