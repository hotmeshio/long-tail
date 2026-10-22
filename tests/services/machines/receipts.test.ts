import { describe, it, expect, vi, afterEach } from 'vitest';

import { MAX_RECEIPT_IDS, ReceiptBatcher } from '../../../services/machines/gateway/receipts';
import { GATEWAY_LOG } from '../../../services/machines/gateway/log';
import { RecordingLog } from '../../../services/machines/testing/recording-log';

const press = { siteId: 's', lineId: 'l', machineId: 'press-01', address: 'P1' };
const cut = { siteId: 's', lineId: 'l', machineId: 'cut-01' };

function rig(opts: { delayMs?: number; fail?: boolean; receipts?: boolean } = {}) {
  const sent: { topic: string; ids: string[] }[] = [];
  const bus = {
    publish: vi.fn(async (topic: string, payload: string) => {
      if (opts.fail) throw new Error('broker down');
      sent.push({ topic, ids: JSON.parse(payload) });
    }),
  } as any;
  const codec = opts.receipts === false ? {} : {
    receipt: (ident: { address?: string; machineId: string }, ids: string[]) => [{ topic: `r/${ident.address ?? ident.machineId}`, payload: JSON.stringify(ids) }],
  };
  const log = new RecordingLog();
  return { sent, log, batcher: new ReceiptBatcher({ bus, codec, delayMs: opts.delayMs ?? 20, log }) };
}

afterEach(() => vi.useRealTimers());

describe('receipt batcher', () => {
  it('confirms a machine\'s ids together after the delay, each machine on its own receipt', async () => {
    vi.useFakeTimers();
    const { sent, batcher } = rig();
    batcher.add(press, 'a');
    batcher.add(press, 'b');
    batcher.add(cut, 'c');
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(sent).toEqual([{ topic: 'r/P1', ids: ['a', 'b'] }, { topic: 'r/cut-01', ids: ['c'] }]);
  });

  it('sends a full batch at once and never repeats an id within one receipt', async () => {
    vi.useFakeTimers();
    const { sent, batcher } = rig({ delayMs: 60_000 });
    batcher.add(press, 'id-0');
    for (let i = 0; i < MAX_RECEIPT_IDS; i++) batcher.add(press, `id-${i}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].ids).toHaveLength(MAX_RECEIPT_IDS);
  });

  it('flushes what is waiting on demand', async () => {
    const { sent, batcher } = rig({ delayMs: 60_000 });
    batcher.add(cut, 'x');
    await batcher.flush();
    expect(sent).toEqual([{ topic: 'r/cut-01', ids: ['x'] }]);
  });

  it('logs a receipt the broker would not take; the machine resends and is confirmed again', async () => {
    const { log, batcher } = rig({ fail: true });
    batcher.add(press, 'a');
    await batcher.flush();
    expect(log.of(GATEWAY_LOG.RECEIPT_FAILED)[0]).toMatchObject({ machine: 'press-01', ids: 1, error: 'broker down' });
  });

  it('sends nothing for a codec without receipts', async () => {
    const { sent, batcher } = rig({ receipts: false });
    expect(batcher.enabled).toBe(false);
    batcher.add(press, 'a');
    await batcher.flush();
    expect(sent).toEqual([]);
  });
});
