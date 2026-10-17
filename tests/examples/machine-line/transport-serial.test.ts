import { describe, it, expect } from 'vitest';

import { DISPOSITION, LocalRedelivery, SerialQueue, type Disposition } from '../../../examples/workflows/machine-line/transport';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('serial queue', () => {
  it('runs work one at a time in arrival order', async () => {
    const q = new SerialQueue();
    const order: string[] = [];
    const slow = q.run(async () => { await sleep(10); order.push('a'); });
    const fast = q.run(async () => { order.push('b'); });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a', 'b']);
  });

  it('keeps going after a failure and reports it to that caller only', async () => {
    const q = new SerialQueue();
    await expect(q.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await q.run(async () => 7)).toBe(7);
    await q.drained();
  });
});

describe('local redelivery', () => {
  it('delivers again after a nak, counting deliveries, until it is acked', async () => {
    const r = new LocalRedelivery(new SerialQueue(), 5);
    const seen: number[] = [];
    await r.deliver(async (n) => { seen.push(n); return n < 3 ? DISPOSITION.NAK : DISPOSITION.ACK; });
    await sleep(40);
    expect(seen).toEqual([1, 2, 3]);
    await r.stop();
  });

  it('treats a thrown handler as a nak, and term as done', async () => {
    const r = new LocalRedelivery(new SerialQueue(), 5);
    let calls = 0;
    await r.deliver(async (): Promise<Disposition> => { calls++; if (calls === 1) throw new Error('row not there yet'); return DISPOSITION.TERM; });
    await sleep(30);
    expect(calls).toBe(2);
    await r.stop();
  });

  it('stop cancels pending retries', async () => {
    const r = new LocalRedelivery(new SerialQueue(), 20);
    let calls = 0;
    await r.deliver(async () => { calls++; return DISPOSITION.NAK; });
    await r.stop();
    await sleep(40);
    expect(calls).toBe(1);
  });
});
