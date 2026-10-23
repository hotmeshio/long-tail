import { describe, it, expect } from 'vitest';

import { buildEnvelope, genericCodec, RECEIPT_FROM, topicOf } from '../../../lib/machines/protocol';

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

  it('can take the receiver\'s carrier bind as its receipt', () => {
    const codec = genericCodec({ root: 'line/v1', receiptFrom: RECEIPT_FROM.BOUND });
    expect(codec.decode(topic('job'), job('bound')).map((s) => s.body?.body.event)).toEqual(['arrived', 'bound']);
    expect(codec.decode(topic('job'), job('started')).map((s) => s.body?.body.event)).toEqual(['started']);
  });

  it('declares its channels and dispatch size', () => {
    const codec = genericCodec({ root: 'line/v1', unitsPerDispatch: 1 });
    expect(codec.channels.events).toContain('alarm/+');
    expect(codec.channels.telemetry).toEqual(['telemetry']);
    expect(codec.unitsPerDispatch).toBe(1);
  });

  it('speaks for a machine by its wire address and reads the address back as its id', () => {
    const line = { machines: [{ machineId: 'cut-01', address: '8f77e321' }] } as any;
    const codec = genericCodec({ root: 'line/v1', line });
    const at = { ...ident, address: '8f77e321' };
    const [wire] = codec.encode(at, { cmdId: 'c1', op: 'dispatch', args: {} });
    expect(wire.topic).toBe('line/v1/site-1/line-1/8f77e321/cmd');
    expect(JSON.parse(wire.payload).source.machine).toBe('8f77e321');
    const [seen] = codec.decode(wire.topic.replace(/cmd$/, 'job'), JSON.stringify(buildEnvelope(at, { event: 'arrived', jobId: 'J1', unitId: 'U1' })));
    expect(seen.parsed?.ident).toEqual({ ...ident, address: '8f77e321' });
    expect(seen.violations).not.toContain('source disagrees with the topic');
  });

  it('an address the line does not know keeps the station its message claims', () => {
    const codec = genericCodec({ root: 'line/v1', line: { machines: [{ machineId: 'cut-01' }] } as any });
    const at = { ...ident, machineId: 'cut-01', address: '9e9e9e9e' };
    const env = buildEnvelope(at, { event: 'arrived', jobId: 'J1', unitId: 'U1' });
    expect(env.source).toEqual({ site: 'site-1', line: 'line-1', machine: '9e9e9e9e', station: 'cut-01' });
    const [seen] = codec.decode('line/v1/site-1/line-1/9e9e9e9e/job', JSON.stringify(env));
    expect(seen.parsed?.ident.machineId).toBe('9e9e9e9e');
    expect(seen.claim).toBe('cut-01');
    expect(seen.violations.filter((v) => v.includes('source'))).toEqual([]);
    expect(buildEnvelope(ident, {}).source).not.toHaveProperty('station');
  });

  it('lays out topics as root/site/line/address/channel unless the codec says otherwise', () => {
    const codec = genericCodec({ root: 'line/v1' });
    expect(topicOf(codec, { siteId: 's', lineId: 'l', address: 'm' }, 'cmd')).toBe('line/v1/s/l/m/cmd');
    expect(topicOf(codec, { siteId: 's', lineId: 'l' }, 'cmd')).toBe('line/v1/s/l/+/cmd');
    const own = { ...codec, topicFor: (sc: { address?: string }, c: string) => `x/${sc.address ?? '+'}/${c}` };
    expect(topicOf(own, { address: 'm' }, 'cmd')).toBe('x/m/cmd');
  });
});

