import { describe, it, expect } from 'vitest';

import { DISPATCH_STATE, GatewayState } from '../../../services/machines/gateway/state';
import { facetsFor } from '../../helpers/machine-line-gateway-harness';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

const TAKEN = Date.parse('2026-03-01T08:00:00.000Z');

function populated(): GatewayState {
  const state = new GatewayState();
  state.takenAt = TAKEN;
  const link = state.link('press-01', TAKEN + 1_000);
  Object.assign(link, { software: '1.2.0', bootId: 'boot-7', sessionId: 'sess-1', jobs: [{ jobId: 'U1-press-01', status: 'running' }], quietRowId: 'q-1' });
  state.index({ ...facetsFor('U1', null, 'press-01'), id: 'h-1', role: 'line-bond', dispatch: DISPATCH_STATE.ACCEPTED });
  state.index({ ...facetsFor('U2', 'press-01', 'cut-01'), id: 'h-2', role: 'line-trim', dispatch: DISPATCH_STATE.WAITING });
  state.hold('press-01', 'U1', 'U1-press-01');
  state.alarms.set(state.alarmKey('press-01', 'A-1'), { machineId: 'press-01', alarmId: 'A-1', raisedAt: '2026-03-01T08:05:00.000Z', level: 'critical', rowId: 'a-1', open: true });
  state.alarms.set(state.alarmKey('press-01', 'A-2'), { machineId: 'press-01', alarmId: 'A-2', raisedAt: '2026-03-01T08:06:00.000Z', level: 'critical', rowId: 'a-2', open: false });
  state.trackCommand('c-1', 'press-01');
  state.trackCommand('c-2', 'cut-01');
  state.raiseClaim('8f77e321', 'cut-01', 'r-1');
  return state;
}

describe('projecting the line', () => {
  it('builds each machine from its link, held units, rows and alarms', () => {
    const view = populated().project(DEFAULT_LINE);
    expect(view).toMatchObject({ siteId: 'site-1', lineId: 'line-1', leading: true, takenAt: '2026-03-01T08:00:00.000Z' });
    expect(view.machines.map((m) => m.machineId)).toEqual(['press-01', 'cut-01', 'inspect-01']);
    const [press, cut, inspect] = view.machines;
    expect(press).toMatchObject({
      process: 'bond', role: 'line-bond', address: 'press-01', online: true, since: '2026-03-01T08:00:01.000Z', lastSeen: '2026-03-01T08:00:01.000Z',
      software: '1.2.0', bootId: 'boot-7', sessionId: 'sess-1', jobs: [{ jobId: 'U1-press-01', status: 'running' }],
      heldUnits: [{ unitId: 'U1', carrierId: 'CR-U1', rowId: 'h-1' }],
      rows: { handoff: 1, command: 1, alarm: 1, offlineRowId: null, quietRowId: 'q-1' },
    });
    expect(press.alarms).toEqual([
      { alarmId: 'A-1', level: 'critical', raisedAt: '2026-03-01T08:05:00.000Z', rowId: 'a-1' },
      { alarmId: 'A-2', level: 'critical', raisedAt: '2026-03-01T08:06:00.000Z', rowId: 'a-2' },
    ]);
    expect(cut).toMatchObject({ online: null, since: null, lastSeen: null, heldUnits: [], rows: { handoff: 1, command: 1, alarm: 0 }, alarms: [], jobs: [] });
    expect(inspect.rows).toEqual({ handoff: 0, command: 0, alarm: 0, offlineRowId: null, quietRowId: null });
    expect(view.contested).toEqual([{ address: '8f77e321', station: 'cut-01', rowId: 'r-1' }]);
  });

  it('a held unit whose handoff closed keeps the row it came in on; a learned address is null until bound', () => {
    const state = populated();
    state.close('h-1');
    expect(state.project(DEFAULT_LINE).machines[0].heldUnits).toEqual([{ unitId: 'U1', carrierId: 'CR-U1', rowId: 'h-1' }]);
    const learned = { ...DEFAULT_LINE, addressing: 'learned' as const };
    expect(state.project(learned).machines[0].address).toBeNull();
    state.bindAddress('press-01', '8f77e321');
    expect(state.project(learned).machines[0].address).toBe('8f77e321');
  });

  it('takenAt is null before the line is taken', () => {
    expect(new GatewayState().project(DEFAULT_LINE).takenAt).toBeNull();
  });
});

describe('cloning the state', () => {
  it('a clone may change without touching the original', () => {
    const state = populated();
    const copy = state.clone();
    copy.hold('press-01', 'U9', 'U9-press-01');
    copy.link('press-01').online = false;
    copy.alarms.delete(copy.alarmKey('press-01', 'A-1'));
    copy.get('h-1')!.dispatch = DISPATCH_STATE.REFUSED;
    copy.close('h-2');
    copy.bindAddress('cut-01', 'ffff');
    copy.trackCommand('c-9', 'press-01');
    expect(state.heldAt('press-01')).toEqual(['U1-press-01']);
    expect(state.link('press-01').online).toBe(true);
    expect(state.alarms.size).toBe(2);
    expect(state.get('h-1')!.dispatch).toBe(DISPATCH_STATE.ACCEPTED);
    expect(state.get('h-2')).toBeDefined();
    expect(state.learnedAddress('cut-01')).toBeUndefined();
    expect(state.openCommandsFor('press-01')).toBe(1);
    expect(copy.project(DEFAULT_LINE).machines[0].rows.command).toBe(2);
  });

  it('a clone carries the settings and the learned addresses', () => {
    const state = populated();
    state.rowOps = ['probe'];
    state.bindAddress('cut-01', 'abcd');
    const copy = state.clone();
    expect(copy.rowOps).toEqual(['probe']);
    expect(copy.takenAt).toBe(TAKEN);
    expect(copy.stationAt('abcd')).toBe('cut-01');
    expect(copy.claimRaised('8f77e321', 'cut-01')).toBe(true);
  });
});
