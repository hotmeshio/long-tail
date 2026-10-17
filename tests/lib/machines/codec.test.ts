import { describe, it, expect } from 'vitest';

import { buildEnvelope, genericCodec, RECEIPT_FROM } from '../../../lib/machines/protocol';

const ident = { siteId: 'site-1', lineId: 'line-1', machineId: 'cut-01' };
const topic = (channel: string) => `line/v1/site-1/line-1/cut-01/${channel}`;
const job = (event: string) => JSON.stringify(buildEnvelope(ident, { event, jobId: 'J1', unitId: 'U1' }));

describe('generic codec', () => {
  it('decodes a machine message into the line protocol, and ignores topics that are not a machine\'s', () => {
    const codec = genericCodec({ root: 'line/v1' });
    const [seen] = codec.decode(topic('job'), job('arrived'));
    expect(seen.parsed).toMatchObject({ kind: 'job', ident });
    expect(seen.body?.body).toMatchObject({ event: 'arrived', unitId: 'U1' });
    expect(codec.decode('other/thing', '{}')).toEqual([]);
  });

  it('encodes a command as one envelope on the machine\'s cmd topic', () => {
    const [wire] = genericCodec({ root: 'line/v1' }).encode(ident, { cmdId: 'c1', op: 'dispatch', args: { jobId: 'J1' } });
    expect(wire.topic).toBe(topic('cmd'));
    expect(JSON.parse(wire.payload)).toMatchObject({ source: { machine: 'cut-01' }, body: { cmdId: 'c1', op: 'dispatch', args: { jobId: 'J1' } } });
  });

  it('can take a receiver\'s start as its receipt, for machines that report no arrival', () => {
    const codec = genericCodec({ root: 'line/v1', receiptFrom: RECEIPT_FROM.STARTED });
    expect(codec.decode(topic('job'), job('arrived'))).toEqual([]);
    expect(codec.decode(topic('job'), job('started')).map((s) => s.body?.body.event)).toEqual(['arrived', 'started']);
    expect(codec.decode(topic('job'), job('finished')).map((s) => s.body?.body.event)).toEqual(['finished']);
  });

  it('declares its channels and dispatch size', () => {
    const codec = genericCodec({ root: 'line/v1', unitsPerDispatch: 1 });
    expect(codec.channels.events).toContain('alarm/+');
    expect(codec.channels.telemetry).toEqual(['telemetry']);
    expect(codec.unitsPerDispatch).toBe(1);
  });
});
