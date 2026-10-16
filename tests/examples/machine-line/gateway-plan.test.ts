import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { planEscalationEvent } from '../../../examples/workflows/machine-line/gateway/plan-escalation';
import { planMachineMessage } from '../../../examples/workflows/machine-line/gateway/plan-machine';
import { GatewayState } from '../../../examples/workflows/machine-line/gateway/state';
import { buildEnvelope, type ParsedTopic } from '../../../examples/workflows/machine-line/protocol';
import { facetsFor } from '../../helpers/machine-line-gateway-harness';

const ident = (machineId: string) => ({ siteId: 'site-1', lineId: 'line-1', machineId });
const job = (machineId: string, body: Record<string, any>) =>
  [{ ident: ident(machineId), kind: 'job' } as ParsedTopic, buildEnvelope(ident(machineId), { unitId: 'U1', ...body })] as const;

function created(state: GatewayState, id: string, from: string | null, to: string | null, extra: Record<string, any> = {}) {
  return planEscalationEvent(state, DEFAULT_LINE, {
    type: 't', escalationId: id, role: 'line-trim', verb: 'created',
    data: { id, type: 'handoff', metadata: { ...facetsFor('U1', from, to), ...extra } },
  }, 60_000);
}

describe('planner: rows that are not there yet, or anymore', () => {
  it('naks an arrival whose row does not exist yet, acks one whose row closed', () => {
    expect(planMachineMessage(new GatewayState(), ...job('cut-01', { event: 'arrived' }), 1).disposition).toBe('nak');
    const state = new GatewayState();
    created(state, 'e1', 'press-01', 'cut-01');
    state.close('e1');
    expect(planMachineMessage(state, ...job('cut-01', { event: 'arrived' }), 1)).toEqual({ actions: [], disposition: 'ack' });
  });

  it('dispatches once per row even when created and claimed both arrive', () => {
    const state = new GatewayState();
    expect(created(state, 'e1', 'press-01', 'cut-01')).toHaveLength(1);
    const again = planEscalationEvent(state, DEFAULT_LINE, { type: 't', escalationId: 'e1', role: 'r', verb: 'claimed', data: { id: 'e1', type: 'handoff', metadata: facetsFor('U1', 'press-01', 'cut-01') } }, 1);
    expect(again).toEqual([]);
  });

  it('does not dispatch a handoff to a person', () => {
    const state = new GatewayState();
    expect(created(state, 'e9', 'inspect-01', null)).toEqual([]);
    expect(state.get('e9')?.toMachine).toBeNull();
  });
});

describe('planner: arrivals and sender records', () => {
  it('resolves a carrier mismatch as an error instead of a receipt', () => {
    const state = new GatewayState();
    created(state, 'e1', 'press-01', 'cut-01');
    const plan = planMachineMessage(state, ...job('cut-01', { event: 'arrived', carrierId: 'CR-9' }), 1);
    expect(plan.actions[0]).toMatchObject({ kind: 'resolve', as: 'cut-01', payload: { received: false, errorCode: 'carrier-mismatch' } });
  });

  it('stream-only events change nothing', () => {
    const state = new GatewayState();
    created(state, 'e1', 'press-01', 'cut-01');
    for (const event of ['queued', 'ready', 'started', 'progress', 'released']) {
      expect(planMachineMessage(state, ...job('cut-01', { event }), 1)).toEqual({ actions: [], disposition: 'ack' });
    }
  });

  it('accumulates the sender record and naks it until the next row exists', () => {
    const state = new GatewayState();
    expect(planMachineMessage(state, ...job('press-01', { event: 'finished', result: 'ok' }), 1).disposition).toBe('nak');
    created(state, 'e2', 'press-01', 'cut-01');
    expect(planMachineMessage(state, ...job('press-01', { event: 'finished', result: 'ok' }), 1).actions[0])
      .toMatchObject({ kind: 'accumulate', rowId: 'e2', itemKey: 'released:U1', as: 'press-01' });
  });
});
