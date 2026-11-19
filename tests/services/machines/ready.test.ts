import { describe, it, expect } from 'vitest';

import { DECISION, ROW_TYPE, readySignalKey } from '../../../services/machines/contracts';
import { isReady, planReady, readyAccepted, readyCreated, readyUnspent, restoreReady, spendReady } from '../../../services/machines/gateway/ready';
import { DISPATCH_STATE, GatewayState } from '../../../services/machines/gateway/state';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

const parsed = (machineId = 'press-01') => ({ kind: 'ready', ident: { siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, machineId } }) as any;
const env = { id: 'msg-1', at: '2026-11-19T00:00:00Z', body: {} } as any;

function paced(): GatewayState {
  const state = new GatewayState();
  state.readyPaced = new Map([['press-01', 'press']]);
  return state;
}

describe('planReady', () => {
  it('raises one keyed ready row for a paced machine, and nothing more while it is being raised', () => {
    const state = paced();
    const [action] = planReady(state, parsed(), env, undefined) as any[];
    expect(action).toMatchObject({
      kind: 'createReadyRow', machineId: 'press-01',
      row: { type: ROW_TYPE.MACHINE_READY, role: 'press', signal_key: readySignalKey(DEFAULT_LINE.siteId, DEFAULT_LINE.lineId, 'press-01', 'msg-1') },
    });
    expect(planReady(state, parsed(), env, true)).toEqual([]);
  });

  it('ignores a machine not paced by ready', () => {
    expect(planReady(paced(), parsed('cut-01'), env, true)).toEqual([]);
  });

  it('raises nothing while a ready awaits the machine\'s acceptance', () => {
    const state = paced();
    readyCreated(state, 'press-01', 'r-1');
    spendReady(state, 'press-01', 'h-1');
    expect(planReady(state, parsed(), env, true)).toEqual([]);
  });

  it('withdraws every unspent ready on ready: false', () => {
    const state = paced();
    readyCreated(state, 'press-01', 'r-1');
    expect(planReady(state, parsed(), env, false)).toEqual([
      { kind: 'resolve', as: 'controller', rowId: 'r-1', payload: { decision: DECISION.WITHDRAWN } },
    ]);
    expect(isReady(state, 'press-01')).toBe(false);
  });
});

describe('a ready\'s life', () => {
  it('is no ready when its row came back ended, or is already spent', () => {
    const state = paced();
    readyCreated(state, 'press-01', 'r-1', 'resolved');
    expect(isReady(state, 'press-01')).toBe(false);
    readyCreated(state, 'press-01', 'r-2');
    spendReady(state, 'press-01', 'h-1');
    readyCreated(state, 'press-01', 'r-2');
    expect(isReady(state, 'press-01')).toBe(false);
  });

  it('resolves naming the handoff on acceptance, and goes back when the dispatch ends unaccepted', () => {
    const state = paced();
    readyCreated(state, 'press-01', 'r-1');
    spendReady(state, 'press-01', 'h-1');
    expect(isReady(state, 'press-01')).toBe(false);
    readyUnspent(state, 'h-1');
    expect(isReady(state, 'press-01')).toBe(true);
    spendReady(state, 'press-01', 'h-2');
    expect(readyAccepted(state, 'h-2')).toEqual({ rowId: 'r-1', payload: { decision: DECISION.DISPATCHED, rowId: 'h-2' } });
    expect(readyAccepted(state, 'h-2')).toBeNull();
  });
});

describe('restoreReady', () => {
  const lt = (open: any[], ended: any[]) => ({ listOpen: async () => open, listEnded: async () => ended }) as any;
  const md = { siteId: DEFAULT_LINE.siteId, lineId: DEFAULT_LINE.lineId, machineId: 'press-01' };

  it('reads open ready rows of this line back', async () => {
    const state = paced();
    expect(await restoreReady(state, lt([{ id: 'r-1', metadata: md }, { id: 'r-x', metadata: { ...md, lineId: 'other' } }], []), DEFAULT_LINE)).toBe(1);
    expect([...state.readyRows]).toEqual([['r-1', 'press-01']]);
  });

  it('gives back the last ready spent on a handoff still unclaimed, and not one the machine accepted', async () => {
    const ended = [{ id: 'r-1', metadata: md, resolver_payload: JSON.stringify({ decision: DECISION.DISPATCHED, rowId: 'h-1' }) }];
    const waiting = paced();
    waiting.index({ id: 'h-1', dispatch: DISPATCH_STATE.WAITING, toMachine: 'press-01', units: [] } as any);
    expect(await restoreReady(waiting, lt([], ended), DEFAULT_LINE)).toBe(1);
    expect(isReady(waiting, 'press-01')).toBe(true);
    const accepted = paced();
    accepted.index({ id: 'h-1', dispatch: DISPATCH_STATE.ACCEPTED, toMachine: 'press-01', units: [] } as any);
    expect(await restoreReady(accepted, lt([], ended), DEFAULT_LINE)).toBe(0);
    expect(isReady(accepted, 'press-01')).toBe(false);
  });
});
