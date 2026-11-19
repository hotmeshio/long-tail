import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, OP, REPLY_STATUS, buildEnvelope, genericCodec, machineTopic } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { commandRow, commandTarget } from '../../../services/machines/commands';
import { controlCommandId } from '../../../services/machines/contracts';
import { CONTROLLER } from '../../../services/machines/gateway/actions';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';

let rig: LineRig;
afterEach(async () => rig?.stop());

const SETPOINT = { type: 'object', required: ['name', 'value'], properties: { name: { type: 'string' }, value: { type: 'number' } } };
const codec = genericCodec({ root: ROOT });
const declared = {
  codec: {
    ...codec, controlOps: [OP.STOP, OP.CANCEL],
    rowOps: ['read', { op: 'setpoint', args: SETPOINT, settleMs: 300 }, { op: 'calibrate', args: { type: 'object' } }],
  },
};

const ident = () => identOf(DEFAULT_LINE, 'press-01');
const ask = (op: string, args: Record<string, unknown> = {}) => rig.lt.parkRow(commandRow(commandTarget(DEFAULT_LINE, 'press-01'), op, args));
const reply = (cmdId: string, status: string, extra: Record<string, unknown> = {}) =>
  rig.broker.publish(machineTopic(ROOT, ident(), CHANNEL.REPLY), JSON.stringify(buildEnvelope(ident(), { cmdId, status, reason: status, ...extra })));

/** A machine whose replies come only from the test. */
async function quietPress(): Promise<void> {
  rig = await startRig({}, { replyTimeoutMs: 400, dispatchAttempts: 1 }, DEFAULT_LINE, declared);
  rig.line.config('press-01', { replyMode: 'drop' });
}

describe('a codec that declares its control ops', () => {
  it('refuses a control op it leaves out, sending nothing', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, declared);
    const ended = await rig.lt.ended(ask(OP.PAUSE).id);
    expect(ended.resolved_by).toBe(CONTROLLER);
    expect(ended.resolver_payload).toMatchObject({ accepted: false, status: 'unsupported' });
    expect(ended.resolver_payload!.reason).toMatch(/pause is not a command a row may ask for; one of stop, cancel, snapshot, read, setpoint/);
    expect(rig.recorder.commands('press-01', OP.PAUSE)).toEqual([]);
  });
});

describe('a row op that declares its args', () => {
  it('refuses args that fail the schema, sending nothing', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, declared);
    const ended = await rig.lt.ended(ask('setpoint', { name: 'platen-temp' }).id);
    expect(ended.resolver_payload).toMatchObject({ accepted: false, status: 'unsupported' });
    expect(ended.resolver_payload!.reason).toMatch(/^setpoint args: value/);
    expect(rig.recorder.commands('press-01', 'setpoint')).toEqual([]);
  });
});

describe('a command reply', () => {
  it('writes the data it carries into the row\'s resolution', async () => {
    await quietPress();
    const row = ask('read', { name: 'platen-temp' });
    await until(() => rig.recorder.commands('press-01', 'read').length);
    reply(controlCommandId(row.id), REPLY_STATUS.ACCEPTED, { data: { name: 'platen-temp', value: 7 } });
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ accepted: true, status: 'accepted', data: { name: 'platen-temp', value: 7 } });
  });

  it('marked preparing holds the row until the final reply under the same command id', async () => {
    await quietPress();
    const row = ask('setpoint', { name: 'platen-temp', value: 9 });
    await until(() => rig.recorder.commands('press-01', 'setpoint').length);
    const cmdId = controlCommandId(row.id);
    reply(cmdId, REPLY_STATUS.ACCEPTED, { preparing: true });
    await sleep(80);
    expect(rig.lt.rows.get(row.id)!.status).toBe('pending');
    reply(cmdId, REPLY_STATUS.COMPLETED, { data: { name: 'platen-temp', was: 7, now: 9 } });
    const ended = await rig.lt.ended(row.id);
    expect(ended.resolved_by).toBe('press-01');
    expect(ended.resolver_payload).toMatchObject({ accepted: true, status: 'completed', data: { was: 7, now: 9 } });
  });

  it('marked preparing resolves with the held reply when no final one comes within the op\'s settle window', async () => {
    await quietPress();
    const row = ask('setpoint', { name: 'platen-temp', value: 7 });
    await until(() => rig.recorder.commands('press-01', 'setpoint').length);
    const started = Date.now();
    reply(controlCommandId(row.id), REPLY_STATUS.ACCEPTED, { preparing: true });
    const ended = await rig.lt.ended(row.id, 2_000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(ended.resolver_payload).toMatchObject({ accepted: true, status: 'accepted' });
  });

  it('marked preparing ends failed when the final reply says so', async () => {
    await quietPress();
    const row = ask('calibrate');
    await until(() => rig.recorder.commands('press-01', 'calibrate').length);
    const cmdId = controlCommandId(row.id);
    reply(cmdId, REPLY_STATUS.ACCEPTED, { preparing: true });
    await sleep(30);
    reply(cmdId, REPLY_STATUS.FAILED, { code: 'E-CAL' });
    expect((await rig.lt.ended(row.id)).resolver_payload).toMatchObject({ accepted: false, status: 'failed', code: 'E-CAL' });
  });
});
