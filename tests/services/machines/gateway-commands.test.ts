import { describe, it, expect, afterEach } from 'vitest';

import { MODE, OP } from '../../../lib/machines/protocol';
import { commandRow, commandTarget } from '../../../services/machines/commands';
import { CONTROLLER } from '../../../services/machines/gateway/actions';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const press = () => rig.line.machine('press-01');
const ask = (op: string, args: Record<string, unknown> = {}, machineId = 'press-01') =>
  rig.lt.parkRow(commandRow({ ...commandTarget(DEFAULT_LINE, 'press-01'), machineId }, op as any, args));

describe('machine-command rows', () => {
  it('pause and resume: the machine resolves each row with its reply', async () => {
    rig = await startRig();
    const paused = await rig.lt.ended(ask(OP.PAUSE).id);
    expect(paused.resolved_by).toBe('press-01');
    expect(paused.resolver_payload).toMatchObject({ accepted: true, machineId: 'press-01', op: 'pause', status: 'accepted' });
    expect(press().enabled).toBe(false);
    const resumed = await rig.lt.ended(ask(OP.RESUME).id);
    expect(resumed.resolver_payload).toMatchObject({ accepted: true, op: 'resume' });
    expect(press().enabled).toBe(true);
  });

  it('changeover loads a recipe version the machine holds', async () => {
    rig = await startRig();
    const [id, versions] = Object.entries(press().recipes)[0];
    const recipe = { id, version: versions[0] };
    const ended = await rig.lt.ended(ask(OP.CHANGEOVER, { recipe }).id);
    expect(ended.resolver_payload).toMatchObject({ accepted: true, op: 'changeover' });
    expect(rig.recorder.commands('press-01', OP.CHANGEOVER)[0].args.recipe).toEqual(recipe);
    await until(() => press().recipeKey() === `${id}@${versions[0]}`, 2_000);
    expect(press().mode).toBe(MODE.IDLE);
  });

  it('a changeover to a version the machine does not hold is refused, as data on the row', async () => {
    rig = await startRig();
    const ended = await rig.lt.ended(ask(OP.CHANGEOVER, { recipe: { id: 'RCP-NONE', version: '9' } }).id);
    expect(ended.resolved_by).toBe('press-01');
    expect(ended.resolver_payload).toMatchObject({ accepted: false, status: 'refused' });
    expect(ended.resolver_payload!.reason).toMatch(/not held/);
  });

  it('an op a row may not ask for, or a machine off the line, is unsupported and never sent', async () => {
    rig = await startRig();
    const dispatch = await rig.lt.ended(ask(OP.DISPATCH).id);
    expect(dispatch.resolved_by).toBe(CONTROLLER);
    expect(dispatch.resolver_payload).toMatchObject({ accepted: false, status: 'unsupported' });
    const stranger = await rig.lt.ended(ask(OP.START, {}, 'mill-99').id);
    expect(stranger.resolver_payload).toMatchObject({ accepted: false, status: 'unsupported' });
    expect(stranger.resolver_payload!.reason).toMatch(/mill-99 is not on/);
    expect(rig.recorder.commands('press-01', OP.DISPATCH)).toEqual([]);
  });

  it('a machine that is away: no-reply, and the command expires instead of running on reconnect', async () => {
    rig = await startRig({}, { replyTimeoutMs: 20 });
    await rig.line.network('press-01', { mode: 'drop' });
    const ended = await rig.lt.ended(ask(OP.STOP).id);
    expect(ended.resolved_by).toBe(CONTROLLER);
    expect(ended.resolver_payload).toMatchObject({ accepted: false, status: 'no-reply' });
    await rig.gateway.idle();
    await rig.line.network('press-01', { mode: 'restore' });
    await until(() => rig.recorder.replies('press-01').some((r) => /expired/.test(r.reason)), 2_000);
    expect(press().enabled).toBe(true);
  });

  it('an open command row is sent when a gateway takes the line', async () => {
    rig = await startRig();
    await rig.gateway.stop();
    const row = ask(OP.PAUSE);
    await sleep(20);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
    rig.gateway = await rig.startGateway();
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolver_payload).toMatchObject({ accepted: true, op: 'pause' });
    expect(rig.lt.calls.filter((c) => c.verb === 'resolve' && c.id === row.id)).toHaveLength(1);
  });
});
