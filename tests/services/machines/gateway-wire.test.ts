import { describe, it, expect, afterEach } from 'vitest';

import { CHANNEL, buildEnvelope, genericCodec, machineTopic, type LineCodec } from '../../../lib/machines/protocol';
import { identOf } from '../../../lib/machines/line';
import { itemKeys } from '../../../services/machines/contracts';
import type { WireEvent } from '../../../types/machines-view';
import { startRig, type LineRig } from '../../helpers/machine-line-gateway-harness';
import { ROOT, sleep, until } from '../../helpers/machine-line-fixtures';
import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';

let rig: LineRig;
afterEach(async () => rig?.stop());

const PRESS = identOf(DEFAULT_LINE, 'press-01');

function tape() {
  const events: WireEvent[] = [];
  return { events, wire: (e: WireEvent) => { events.push(e); } };
}

describe('the wire record', () => {
  it('records every message read, with its payload, and every command sent', async () => {
    const { events, wire } = tape();
    rig = await startRig({}, {}, DEFAULT_LINE, { wire });
    // The machines' retained presence and snapshots were read on taking the line.
    const presence = events.filter((e) => e.direction === 'in' && e.kind === 'presence' && e.machineId === 'press-01');
    expect(presence.length).toBeGreaterThan(0);
    expect(presence[0]).toMatchObject({ type: 'machine.wire', siteId: 'site-1', lineId: 'line-1', address: 'press-01', channel: 'presence', event: 'online', retained: true });
    expect(presence[0].summary).toMatch(/^presence online/);
    expect(presence[0].payload).toMatchObject({ body: { online: true } });
    expect(presence[0].id).toBeTruthy();

    const row = await rig.handoff('U1', null, 'press-01');
    expect(row.status).toBe('resolved');
    const sent = events.filter((e) => e.direction === 'out' && e.kind === 'cmd' && e.event === 'dispatch' && e.machineId === 'press-01');
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ channel: CHANNEL.CMD, topic: machineTopic(ROOT, PRESS, CHANNEL.CMD), retained: false, actions: [] });
    expect(sent[0].summary).toMatch(/^cmd dispatch U1-press-01/);
    expect((sent[0].payload as any).body.op).toBe('dispatch');

    const arrived = events.find((e) => e.direction === 'in' && e.kind === 'job' && e.event === 'arrived' && e.machineId === 'press-01');
    expect(arrived).toBeDefined();
    expect(arrived!.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ verb: 'accumulate', rowId: row.id, itemKey: itemKeys.arrived('U1') }),
      expect.objectContaining({ verb: 'resolve', rowId: row.id }),
    ]));
    // One record per message: the arrival's envelope id appears once.
    expect(events.filter((e) => e.id === arrived!.id).length).toBe(1);
    const reply = events.find((e) => e.direction === 'in' && e.kind === 'reply' && e.machineId === 'press-01');
    expect(reply?.event).toBe('accepted');
    expect(reply?.actions[0]).toMatchObject({ verb: 'ack' });
    for (const e of events) expect(e.payload).toBeDefined();
  });

  it('leaves telemetry out unless the line asks for it', async () => {
    const { events, wire } = tape();
    rig = await startRig({}, {}, DEFAULT_LINE, { wire });
    const telemetry = () => events.filter((e) => e.kind === 'telemetry');
    rig.broker.publish(machineTopic(ROOT, PRESS, CHANNEL.TELEMETRY), JSON.stringify(buildEnvelope(PRESS, { readings: { temp: 21 } })));
    await sleep(30);
    expect(telemetry()).toEqual([]);
    await rig.stop();

    rig = await startRig({}, { wireTelemetry: true }, DEFAULT_LINE, { wire });
    rig.broker.publish(machineTopic(ROOT, PRESS, CHANNEL.TELEMETRY), JSON.stringify(buildEnvelope(PRESS, { readings: { temp: 22 } })));
    await until(() => telemetry().length === 1);
    expect(telemetry()[0]).toMatchObject({ event: null, summary: 'telemetry 1 reading', actions: [{ verb: 'ack' }] });
  });

  it('records a message the codec cannot read, and one that is not a machine\'s', async () => {
    const { events, wire } = tape();
    const base = genericCodec({ root: ROOT, line: DEFAULT_LINE });
    const codec: LineCodec = {
      ...base,
      decode(topic, payload, retained) {
        if (topic.endsWith('/report/boom')) throw new Error('boom');
        return base.decode(topic, payload, retained);
      },
    };
    rig = await startRig({}, {}, DEFAULT_LINE, { wire, codec });
    rig.broker.publish(machineTopic(ROOT, PRESS, `${CHANNEL.REPORT}/boom`), JSON.stringify(buildEnvelope(PRESS, { n: 1 })));
    const broken = await until(() => events.find((e) => e.actions.some((a) => a.verb === 'unreadable')));
    expect(broken).toMatchObject({ kind: 'unknown', machineId: null, summary: 'boom', actions: [{ verb: 'unreadable', detail: 'boom' }] });
    expect(typeof broken.payload).toBe('string');
    expect(broken.payload).toContain('"n":1');

    rig.broker.publish(`${ROOT}/site-1/line-1/stray`, 'hello');
    const stray = await until(() => events.find((e) => e.topic === `${ROOT}/site-1/line-1/stray`));
    expect(stray).toMatchObject({ kind: 'unknown', summary: 'not a machine message', actions: [{ verb: 'none', detail: 'not a machine message' }], payload: 'hello' });
  });

  it('a message whose row is not there yet waits, and says so', async () => {
    const { events, wire } = tape();
    rig = await startRig({}, {}, DEFAULT_LINE, { wire });
    rig.broker.publish(machineTopic(ROOT, PRESS, CHANNEL.JOB), JSON.stringify(buildEnvelope(PRESS, {
      event: 'arrived', jobId: 'U7-press-01', unitId: 'U7', orderRef: 'ORD-1', recipe: null, carrierId: 'CR-U7', peer: null,
    })));
    const waiting = await until(() => events.find((e) => e.kind === 'job' && e.event === 'arrived' && e.summary.includes('U7')));
    expect(waiting.actions).toEqual([{ verb: 'none', detail: 'waiting for its row (delivery 1)' }]);
  });

  it('keeps the last events in the leader\'s window, newest first', async () => {
    rig = await startRig({}, { wireWindow: 50 }, DEFAULT_LINE, { wire: () => undefined });
    const row = await rig.handoff('U1', null, 'press-01');
    expect(row.status).toBe('resolved');
    const window = rig.gateway.window.read();
    expect(window.length).toBeLessThanOrEqual(50);
    expect(new Date(window[0].at).getTime()).toBeGreaterThanOrEqual(new Date(window[window.length - 1].at).getTime());
    expect(rig.gateway.window.read({ direction: 'out', kind: 'cmd', machine: 'press-01' })[0]).toMatchObject({ event: 'dispatch', machineId: 'press-01' });
  });
});

