import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, buildEnvelope, genericCodec, machineTopic, type LineCodec } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { ROOT, until } from '../../helpers/machine-line-fixtures';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';

let rig: LineRig;
afterEach(async () => rig?.stop());

/** The generic protocol, plus a receipt for every job event: the shape of a protocol whose machines keep an outbox. */
function receiptCodec(): LineCodec {
  const base = genericCodec({ root: ROOT });
  return {
    ...base,
    decode: (topic, payload, retained) => base.decode(topic, payload, retained)
      .map((seen) => (seen.parsed?.kind === 'job' && seen.body ? { ...seen, receiptId: seen.body.id } : seen)),
    receipt: (ident, ids) => [{ topic: machineTopic(ROOT, ident, 'receipt'), payload: JSON.stringify({ ids }) }],
  };
}

function watchReceipts(r: LineRig): string[] {
  const ids: string[] = [];
  r.broker.connect('receipts');
  r.broker.subscribe('receipts', `${ROOT}/+/+/+/receipt`, (msg) => ids.push(...JSON.parse(msg.payload).ids));
  return ids;
}

describe('gateway receipts', () => {
  it('confirms each job event once the gateway has acted on it', async () => {
    rig = await startRig({}, { receiptDelayMs: 5 }, DEFAULT_LINE, { codec: receiptCodec() });
    const confirmed = watchReceipts(rig);
    await rig.handoff('U1', null, 'press-01');
    const arrivalId = rig.recorder.of('press-01', 'job').find((e) => e.body.event === 'arrived')!.id;
    await until(() => confirmed.includes(arrivalId), 2_000);
  });

  it('confirms an event only after it lands, never while it waits for its row', async () => {
    rig = await startRig({}, { receiptDelayMs: 5 }, DEFAULT_LINE, { codec: receiptCodec() });
    const confirmed = watchReceipts(rig);
    const ident = identOf(DEFAULT_LINE, 'press-01');
    const early = buildEnvelope(ident, { event: 'arrived', jobId: 'U7-press-01', unitId: 'U7', orderRef: 'ORD-1', recipe: null, carrierId: 'CR-U7' });
    rig.broker.publish(machineTopic(ROOT, ident, CHANNEL.JOB), JSON.stringify(early));
    await new Promise((r) => setTimeout(r, 150));
    expect(confirmed).not.toContain(early.id);
    await rig.handoff('U7', null, 'press-01');
    await until(() => confirmed.includes(early.id), 2_000);
  });

  it('sends no receipts for the generic protocol', async () => {
    rig = await startRig({}, { receiptDelayMs: 5 });
    const confirmed = watchReceipts(rig);
    await rig.handoff('U1', null, 'press-01');
    await new Promise((r) => setTimeout(r, 50));
    expect(confirmed).toEqual([]);
  });
});
