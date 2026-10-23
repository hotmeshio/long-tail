import { describe, it, expect } from 'vitest';

import { loadMachineLineConfig } from '../../../services/machines/config';
import { clientIds, stationRole, validateLine } from '../../../lib/machines/line';
import { DEFAULT_LINE, loadLine } from '../../../examples/workflows/machine-line/line';

describe('machine line config', () => {
  it('defaults to the memory transport and memory feed', () => {
    expect(loadMachineLineConfig({})).toMatchObject({ transport: 'memory', feed: 'memory', topicRoot: 'line/v1', replyTimeoutMs: 5000, quietMs: 90_000, dispatchTtlMs: 600_000 });
  });

  it('reads the site broker login and the gateway timings', () => {
    const c = loadMachineLineConfig({
      MACHINE_TRANSPORT: 'nats', MACHINE_SITE_NATS_URL: 'nats://site:4222', MACHINE_MQTT_URL: 'mqtts://site:8883', NATS_URL: 'nats://lt:4222',
      MACHINE_SITE_NATS_USER: 'gw', MACHINE_SITE_NATS_PASSWORD: 'pw', MACHINE_QUIET_MS: '0', MACHINE_DISPATCH_TTL_MS: '1000',
    });
    expect(c).toMatchObject({ siteNatsUser: 'gw', siteNatsPassword: 'pw', quietMs: 0, dispatchTtlMs: 1000 });
  });

  it('nats needs the site NATS and the machine broker, and defaults to the core feed on MQTT 5', () => {
    expect(() => loadMachineLineConfig({ MACHINE_TRANSPORT: 'nats' })).toThrow(/MACHINE_SITE_NATS_URL/);
    expect(() => loadMachineLineConfig({ MACHINE_TRANSPORT: 'nats', MACHINE_SITE_NATS_URL: 'nats://site:4222' })).toThrow(/MACHINE_MQTT_URL/);
    const site = { MACHINE_TRANSPORT: 'nats', MACHINE_SITE_NATS_URL: 'nats://site:4222', MACHINE_MQTT_URL: 'mqtts://site:8883' };
    expect(() => loadMachineLineConfig(site)).toThrow(/NATS_URL/);
    const c = loadMachineLineConfig({ ...site, NATS_URL: 'nats://lt:4222' });
    expect(c.feed).toBe('core');
    expect(c.mqtt?.protocolVersion).toBe(5);
  });

  it('mqtt defaults to MQTT 5 and the core feed, which needs Long Tail NATS', () => {
    expect(() => loadMachineLineConfig({ MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtts://b:8883' })).toThrow(/NATS_URL/);
    const c = loadMachineLineConfig({ MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtts://b:8883', NATS_URL: 'nats://lt:4222' });
    expect(c).toMatchObject({ feed: 'core', ltNatsUrl: 'nats://lt:4222' });
    expect(c.mqtt?.protocolVersion).toBe(5);
  });

  it('throws on unknown selections instead of falling back', () => {
    expect(() => loadMachineLineConfig({ MACHINE_TRANSPORT: 'carrier-pigeon' })).toThrow(/MACHINE_TRANSPORT/);
    expect(() => loadMachineLineConfig({ MACHINE_ESCALATION_FEED: 'jetstream' })).toThrow(/jetstream/);
    expect(() => loadMachineLineConfig({ MACHINE_REPLY_TIMEOUT_MS: '-1' })).toThrow();
  });
});

describe('line definition', () => {
  it('loads the default line in route order', () => {
    const line = loadLine();
    expect(line.machines.map((m) => m.machineId)).toEqual(['press-01', 'cut-01', 'inspect-01']);
    expect(clientIds(line)).toEqual(['site-1-line-1-press-01', 'site-1-line-1-cut-01', 'site-1-line-1-inspect-01']);
  });

  it('rejects ids that break topics, duplicates and empty lines', () => {
    expect(() => validateLine({ ...DEFAULT_LINE, siteId: 'site.1' })).toThrow();
    expect(() => validateLine({ ...DEFAULT_LINE, machines: [] })).toThrow(/no machines/);
    expect(() => validateLine({ ...DEFAULT_LINE, machines: [DEFAULT_LINE.machines[0], DEFAULT_LINE.machines[0]] })).toThrow(/duplicate/);
  });

  it('names each machine on the wire by its address when it has one, and keeps addresses unique', () => {
    const [press, ...rest] = DEFAULT_LINE.machines;
    const line = { ...DEFAULT_LINE, machines: [{ ...press, address: '8f77e321' }, ...rest] };
    expect(clientIds(validateLine(line))[0]).toBe('site-1-line-1-8f77e321');
    expect(() => validateLine({ ...line, machines: [line.machines[0], { ...rest[0], address: '8f77e321' }] })).toThrow(/duplicate address/);
    expect(() => validateLine({ ...line, machines: [{ ...press, address: 'a/b' }] })).toThrow();
  });

  it('a line that learns addresses needs none declared, names no broker user for those stations, and rejects an unknown mode', () => {
    const learned = validateLine({ ...DEFAULT_LINE, addressing: 'learned' });
    expect(clientIds(learned)).toEqual([]);
    const [press, ...rest] = DEFAULT_LINE.machines;
    expect(clientIds(validateLine({ ...learned, machines: [{ ...press, address: '8f77e321' }, ...rest] }))).toEqual(['site-1-line-1-8f77e321']);
    expect(() => validateLine({ ...DEFAULT_LINE, addressing: 'guessed' as any })).toThrow(/addressing must be one of/);
  });

  it('accepts a whole queue depth of at least 1 and rejects anything else', () => {
    const withDepth = (queueDepth: unknown) => ({ ...DEFAULT_LINE, machines: [{ ...DEFAULT_LINE.machines[0], queueDepth: queueDepth as number }] });
    expect(validateLine(withDepth(3)).machines[0].queueDepth).toBe(3);
    for (const bad of [0, -1, 1.5, '2']) expect(() => validateLine(withDepth(bad))).toThrow(/queueDepth/);
  });

  it('names one Long Tail role per process', () => {
    expect(stationRole('trim')).toBe('line-trim');
    expect(stationRole('final_check')).toBe('line-final-check');
  });
});
