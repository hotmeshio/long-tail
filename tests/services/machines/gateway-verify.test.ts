import { describe, it, expect, afterEach } from 'vitest';

import { OP } from '../../../lib/machines/protocol';
import { commandRow, commandTarget } from '../../../services/machines/commands';
import { CONTROLLER } from '../../../services/machines/gateway/actions';
import { ROW_TYPE } from '../../../services/machines/contracts';
import { concernsLine, statusFits } from '../../../services/machines/gateway/plan-escalation';
import { GatewayState } from '../../../services/machines/gateway/state';
import { facetsFor, startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const PRESS = commandTarget(DEFAULT_LINE, 'press-01');
const pauseFacets = { siteId: 'site-1', lineId: 'line-1', machineId: 'press-01', op: OP.PAUSE, args: {} };

/** An event no stored row backs, as anyone able to publish on the event bus could send. */
function forge(id: string, verb: string, role: string, data: Record<string, any>): void {
  rig.feed.emit({ type: `system.escalation.${role}.${id}.${verb}`, escalationId: id, role, data: { id, ...data } });
}

describe('the gateway acts on stored rows, never on what an event claims', () => {
  it('an invented command event sends nothing', async () => {
    rig = await startRig();
    forge('e-forged', 'created', PRESS.role, { type: ROW_TYPE.MACHINE_COMMAND, status: 'pending', metadata: pauseFacets });
    await sleep(50);
    await rig.gateway.idle();
    expect(rig.recorder.commands('press-01', OP.PAUSE)).toEqual([]);
    expect(rig.line.machine('press-01').enabled).toBe(true);
  });

  it('an event dressing up another row as a command sends nothing', async () => {
    rig = await startRig();
    const review = rig.lt.parkRow({ type: 'review', role: 'reviewer', metadata: { note: 'look at this' } });
    forge(review.id, 'created', PRESS.role, { type: ROW_TYPE.MACHINE_COMMAND, status: 'pending', metadata: pauseFacets });
    await sleep(50);
    await rig.gateway.idle();
    expect(rig.recorder.commands('press-01', OP.PAUSE)).toEqual([]);
    expect(rig.lt.rows.get(review.id)!.status).toBe('pending');
  });

  it('a command row on a role the controller cannot read is left alone', async () => {
    rig = await startRig();
    rig.lt.holds.set(CONTROLLER, new Set(['line-trim', 'line-inspect', 'line-exit', 'line-operator']));
    const row = rig.lt.parkRow(commandRow(PRESS, OP.PAUSE));
    await sleep(50);
    await rig.gateway.idle();
    expect(rig.recorder.commands('press-01', OP.PAUSE)).toEqual([]);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
  });

  it('a command row parked on another machine\'s role is refused as unsupported', async () => {
    rig = await startRig();
    const row = rig.lt.parkRow(commandRow({ ...PRESS, role: 'line-trim' }, OP.PAUSE));
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ accepted: false, status: 'unsupported', reason: expect.stringContaining('parked on line-bond') });
    expect(rig.recorder.commands('press-01', OP.PAUSE)).toEqual([]);
  });

  it('an invented cancel for a live handoff changes nothing; the unit still arrives', async () => {
    rig = await startRig();
    const row = rig.park('U1', null, 'press-01');
    await until(() => rig.lt.rows.get(row.id)!.assigned_to === 'press-01', 2_000);
    forge(row.id, 'cancelled', row.role, { type: ROW_TYPE.HANDOFF, status: 'cancelled', metadata: row.metadata });
    const ended = await rig.lt.ended(row.id, 3_000);
    expect(ended.resolver_payload).toMatchObject({ received: true });
    expect(rig.recorder.commands('press-01', OP.CANCEL)).toEqual([]);
  });
});

describe('which events lead to a row read', () => {
  const event = (verb: string, data: Record<string, any>) => ({ type: 't', escalationId: 'e1', role: 'line-bond', verb, data });

  it('only the verbs the gateway acts on, for rows on this line', () => {
    const state = new GatewayState();
    expect(concernsLine(state, DEFAULT_LINE, event('created', { type: ROW_TYPE.HANDOFF, metadata: facetsFor('U1', null, 'press-01') }))).toBe(true);
    expect(concernsLine(state, DEFAULT_LINE, event('created', { type: ROW_TYPE.MACHINE_COMMAND, metadata: pauseFacets }))).toBe(true);
    expect(concernsLine(state, DEFAULT_LINE, event('updated', { type: ROW_TYPE.MACHINE_COMMAND, metadata: pauseFacets }))).toBe(false);
    expect(concernsLine(state, DEFAULT_LINE, event('created', { type: ROW_TYPE.MACHINE_COMMAND, metadata: { ...pauseFacets, lineId: 'line-2' } }))).toBe(false);
    expect(concernsLine(state, DEFAULT_LINE, event('created', { type: 'review', metadata: { siteId: 'site-1', lineId: 'line-1' } }))).toBe(false);
  });

  it('a stored status must agree with the verb', () => {
    expect(statusFits('created', 'pending')).toBe(true);
    expect(statusFits('claimed', 'pending')).toBe(true);
    expect(statusFits('created', 'resolved')).toBe(false);
    expect(statusFits('cancelled', 'pending')).toBe(false);
    expect(statusFits('expired', 'expired')).toBe(true);
    expect(statusFits('resolved', 'cancelled')).toBe(false);
  });
});
