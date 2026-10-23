import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { planEscalationEvent } from '../../../services/machines/gateway/plan-escalation';
import { planMachineMessage } from '../../../services/machines/gateway/plan-machine';
import { GatewayState } from '../../../services/machines/gateway/state';
import { buildEnvelope, type ParsedTopic } from '../../../lib/machines/protocol';
import { facetsFor } from '../../helpers/machine-line-gateway-harness';

const ident = (machineId: string) => ({ siteId: 'site-1', lineId: 'line-1', machineId });
const job = (machineId: string, body: Record<string, any>) =>
  [{ ident: ident(machineId), kind: 'job' } as ParsedTopic, buildEnvelope(ident(machineId), { unitId: 'U1', ...body })] as const;

function created(state: GatewayState, id: string, from: string | null, to: string | null, extra: Record<string, any> = {}, role = 'line-trim') {
  return planEscalationEvent(state, DEFAULT_LINE, {
    type: 't', escalationId: id, role, verb: 'created',
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
    const again = planEscalationEvent(state, DEFAULT_LINE, { type: 't', escalationId: 'e1', role: 'line-trim', verb: 'claimed', data: { id: 'e1', type: 'handoff', metadata: facetsFor('U1', 'press-01', 'cut-01') } }, 1);
    expect(again).toEqual([]);
  });

  it('ignores rows that belong to another line', () => {
    const state = new GatewayState();
    expect(created(state, 'e7', null, 'press-01', { lineId: 'line-2' })).toEqual([]);
    expect(state.get('e7')).toBeUndefined();
  });

  it('does not dispatch a handoff to a person', () => {
    const state = new GatewayState();
    expect(created(state, 'e9', 'inspect-01', null, {}, 'line-exit')).toEqual([]);
    expect(state.get('e9')?.toMachine).toBeNull();
  });

  it('ignores a handoff into a machine parked on another role, and one to a person off the receiver roles', () => {
    const state = new GatewayState();
    expect(created(state, 'e10', 'press-01', 'cut-01', {}, 'line-bond')).toEqual([]);
    expect(created(state, 'e11', 'inspect-01', null, {}, 'reviewer')).toEqual([]);
    expect(state.get('e10')).toBeUndefined();
    expect(state.get('e11')).toBeUndefined();
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

  it('writes a sender record that came before its row ahead of the arrival that resolves the row', () => {
    const state = new GatewayState();
    expect(planMachineMessage(state, ...job('press-01', { event: 'finished', result: 'ok', lot: 'L-1' }), 1).disposition).toBe('nak');
    created(state, 'e2', 'press-01', 'cut-01');
    state.get('e2')!.dispatch = 'accepted';
    const arrived = planMachineMessage(state, ...job('cut-01', { event: 'arrived' }), 1).actions;
    expect(arrived.map((a: any) => [a.as, a.itemKey])).toEqual([['press-01', 'released:U1'], ['cut-01', 'arrived:U1']]);
    expect(planMachineMessage(state, ...job('cut-01', { event: 'arrived' }), 1).actions.map((a: any) => a.itemKey)).toEqual(['arrived:U1']);
  });

  it('an early record from another sender job, or one that is not ok, is left to the sender message itself', () => {
    const state = new GatewayState();
    planMachineMessage(state, ...job('press-01', { event: 'finished', jobId: 'U1-press-01', result: 'ok' }), 1);
    created(state, 'e3', 'press-01', 'cut-01', { senderJobId: 'U1-press-01-a2' });
    expect(planMachineMessage(state, ...job('cut-01', { event: 'arrived' }), 1).actions.map((a: any) => a.itemKey)).toEqual(['arrived:U1']);
    const rejected = new GatewayState();
    planMachineMessage(rejected, ...job('press-01', { event: 'finished', result: 'reject' }), 1);
    created(rejected, 'e4', 'press-01', 'cut-01');
    expect(planMachineMessage(rejected, ...job('cut-01', { event: 'arrived' }), 1).actions.map((a: any) => a.itemKey)).toEqual(['arrived:U1']);
  });
});

describe('planner: attempts and restarts', () => {
  it('ignores an event from an earlier attempt\'s job', () => {
    const state = new GatewayState();
    created(state, 'e2', 'press-01', 'cut-01', { jobId: 'U1-cut-01-a2', attempt: 2 });
    state.get('e2')!.dispatch = 'accepted';
    expect(planMachineMessage(state, ...job('cut-01', { event: 'withdrawn', jobId: 'U1-cut-01' }), 1).actions).toEqual([]);
    expect(planMachineMessage(state, ...job('cut-01', { event: 'withdrawn', jobId: 'U1-cut-01-a2' }), 1).actions.length).toBeGreaterThan(0);
  });

  it('a sender event counts only for the sender job the row names', () => {
    const state = new GatewayState();
    created(state, 'e3', 'press-01', 'cut-01', { senderJobId: 'U1-press-01-a2' });
    const stale = planMachineMessage(state, ...job('press-01', { event: 'finished', jobId: 'U1-press-01', result: 'reject', reason: 'old' }), 1);
    expect(stale.actions).toEqual([]);
  });

  it('a row read back already claimed counts as accepted and is not dispatched again', () => {
    const state = new GatewayState();
    const actions = planEscalationEvent(state, DEFAULT_LINE, {
      type: 'reconcile', escalationId: 'e4', role: 'line-trim', verb: 'created',
      data: { id: 'e4', type: 'handoff', assigned_to: 'bot-cut', metadata: facetsFor('U1', 'press-01', 'cut-01') },
    }, 60_000);
    expect(actions).toEqual([]);
    expect(state.get('e4')!.dispatch).toBe('accepted');
  });
});
