import { describe, it, expect, afterEach } from 'vitest';

import { OP, genericCodec, type LineCodec, type RowOp } from '../../../lib/machines/protocol';
import { commandRow, commandTarget } from '../../../services/machines/commands';
import { CONTROLLER } from '../../../services/machines/gateway/actions';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const BEACON = 'beacon';
const ask = (op: string, args: Record<string, unknown> = {}) => rig.lt.parkRow(commandRow(commandTarget(DEFAULT_LINE, 'press-01'), op as any, args));

function codecOf(rowOps: RowOp[], encodes = true): LineCodec {
  const generic = genericCodec({ root: ROOT });
  return { ...generic, rowOps, encode: (ident, command) => (encodes || command.op !== BEACON ? generic.encode(ident, command) : []) };
}

describe('one-way row ops', () => {
  it('is sent once and resolves sent, without waiting for a reply', async () => {
    rig = await startRig({}, { replyTimeoutMs: 5_000, dispatchAttempts: 3 }, DEFAULT_LINE, { codec: codecOf([{ op: BEACON, reply: false }]) });
    const started = Date.now();
    const ended = await rig.lt.ended(ask(BEACON, { text: 'hello' }).id);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(ended.resolved_by).toBe(CONTROLLER);
    expect(ended.resolver_payload).toMatchObject({ accepted: true, machineId: 'press-01', op: BEACON, status: 'sent' });
    await rig.gateway.idle();
    const sent = rig.recorder.commands('press-01', BEACON);
    expect(sent).toHaveLength(1);
    expect(sent[0].args).toEqual({ text: 'hello' });
  });

  it('carries no expiry, and is not sent again when a gateway takes the line after it resolved', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, { codec: codecOf([{ op: BEACON, reply: false }]) });
    const row = ask(BEACON);
    await rig.lt.ended(row.id);
    await rig.gateway.stop();
    rig.gateway = await rig.startGateway();
    await rig.gateway.idle();
    const sent = rig.recorder.commands('press-01', BEACON);
    expect(sent).toHaveLength(1);
    expect(sent[0].args).not.toHaveProperty('expiresAt');
  });

  it('resolves unsupported when the codec has no message for it', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, { codec: codecOf([{ op: BEACON, reply: false }], false) });
    const ended = await rig.lt.ended(ask(BEACON).id);
    expect(ended.resolver_payload).toMatchObject({ accepted: false, op: BEACON, status: 'unsupported' });
    expect(rig.recorder.commands('press-01', BEACON)).toEqual([]);
  });

  it('ops declared by name still ask and resolve with the reply', async () => {
    rig = await startRig({}, {}, DEFAULT_LINE, { codec: codecOf(['purge', { op: BEACON, reply: false }]) });
    const paused = await rig.lt.ended(ask(OP.PAUSE).id);
    expect(paused.resolved_by).toBe('press-01');
    const purged = await rig.lt.ended(ask('purge').id);
    expect(purged.resolved_by).toBe('press-01');
    expect(purged.resolver_payload).toMatchObject({ status: 'refused' });
  });
});
