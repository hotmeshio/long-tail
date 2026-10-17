import { describe, it, expect } from 'vitest';

import { machineLoad, planPacing } from '../../../services/machines/gateway/pacing';
import { DISPATCH_STATE, GatewayState, type DispatchState, type HandoffRow } from '../../../services/machines/gateway/state';
import { facetsFor } from '../../helpers/machine-line-gateway-harness';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

const LINE = { ...DEFAULT_LINE, machines: DEFAULT_LINE.machines.map((m) => (m.machineId === 'press-01' ? { ...m, queueDepth: 2 } : m)) };

function row(id: string, units: string | string[], from: string | null, to: string | null, dispatch: DispatchState): HandoffRow {
  return { ...facetsFor(units, from, to), id, role: 'r', dispatch };
}

function stateWith(...rows: HandoffRow[]): GatewayState {
  const state = new GatewayState();
  for (const r of rows) state.index(r);
  return state;
}

describe('machineLoad', () => {
  it('counts jobs dispatched into the machine, not ones waiting, refused or unsent', () => {
    const state = stateWith(
      row('a', 'U1', null, 'press-01', DISPATCH_STATE.PENDING), row('b', 'U2', null, 'press-01', DISPATCH_STATE.ACCEPTED),
      row('c', 'U3', null, 'press-01', DISPATCH_STATE.WAITING), row('d', 'U4', null, 'press-01', DISPATCH_STATE.REFUSED),
      row('e', 'U5', null, 'press-01', DISPATCH_STATE.NONE),
    );
    expect([...machineLoad(state, 'press-01')].sort()).toEqual(['U1-press-01', 'U2-press-01']);
  });

  it('counts units waiting on the machine to move on, and units that arrived and have not left', () => {
    const state = stateWith(row('a', 'U1', 'press-01', 'cut-01', DISPATCH_STATE.ACCEPTED));
    state.hold('press-01', 'U2', 'U2-press-01');
    expect([...machineLoad(state, 'press-01')].sort()).toEqual(['U1-press-01', 'U2-press-01']);
    state.letGo('press-01', 'U2');
    expect([...machineLoad(state, 'press-01')]).toEqual(['U1-press-01']);
  });

  it('a snapshot drops held units whose job the machine no longer lists', () => {
    const state = new GatewayState();
    state.hold('press-01', 'U1', 'J1');
    state.hold('press-01', 'U2', 'J2');
    state.keepHeld('press-01', new Set(['J2']));
    expect(state.heldAt('press-01')).toEqual(['J2']);
  });

  it('counts a job once when a row and a held unit name it', () => {
    const state = stateWith(row('a', 'U1', null, 'press-01', DISPATCH_STATE.ACCEPTED));
    state.hold('press-01', 'U1', 'U1-press-01');
    expect(machineLoad(state, 'press-01').size).toBe(1);
  });
});

describe('planPacing', () => {
  it('sends waiting rows oldest first while the machine has room', () => {
    const state = stateWith(
      row('a', 'U1', null, 'press-01', DISPATCH_STATE.ACCEPTED),
      row('b', 'U2', null, 'press-01', DISPATCH_STATE.WAITING), row('c', 'U3', null, 'press-01', DISPATCH_STATE.WAITING),
    );
    const actions = planPacing(state, LINE, 60_000);
    expect(actions.map((a) => (a as any).rowId)).toEqual(['b']);
    expect(state.get('b')!.dispatch).toBe(DISPATCH_STATE.PENDING);
    expect(state.get('c')!.dispatch).toBe(DISPATCH_STATE.WAITING);
  });

  it('a full machine holds back a later row that would fit', () => {
    const state = stateWith(
      row('a', 'U1', null, 'press-01', DISPATCH_STATE.ACCEPTED),
      row('b', ['U2', 'U3', 'U4'], null, 'press-01', DISPATCH_STATE.WAITING), row('c', 'U5', null, 'press-01', DISPATCH_STATE.WAITING),
    );
    state.unitsPerDispatch = 1;
    expect(planPacing(state, LINE, 60_000)).toEqual([]);
  });

  it('an idle machine takes the next row even when it is larger than the depth', () => {
    const state = stateWith(row('b', ['U2', 'U3', 'U4'], null, 'press-01', DISPATCH_STATE.WAITING));
    state.unitsPerDispatch = 1;
    expect(planPacing(state, LINE, 60_000).map((a) => a.kind)).toEqual(['dispatch']);
  });

  it('a machine without a depth takes every waiting row', () => {
    const state = stateWith(
      row('a', 'U1', null, 'cut-01', DISPATCH_STATE.WAITING), row('b', 'U2', null, 'cut-01', DISPATCH_STATE.WAITING),
      row('c', 'U3', null, 'cut-01', DISPATCH_STATE.WAITING),
    );
    expect(planPacing(state, LINE, 60_000)).toHaveLength(3);
  });

  it('a waiting row for a machine on software the line does not allow is refused when its turn comes', () => {
    const line = { ...LINE, machines: LINE.machines.map((m) => (m.machineId === 'press-01' ? { ...m, allowedSoftware: ['2.0.0'] } : m)) };
    const state = stateWith(row('b', 'U2', null, 'press-01', DISPATCH_STATE.WAITING));
    state.link('press-01').software = '1.0.0';
    const [action] = planPacing(state, line, 60_000);
    expect(action).toMatchObject({ kind: 'resolve', payload: { errorCode: 'software-unsupported' } });
  });
});
