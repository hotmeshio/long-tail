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
      MACHINE_TRANSPORT: 'nats', MACHINE_SITE_NATS_URL: 'nats://site:4222', MACHINE_MQTT_URL: 'mqtts://site:8883',
      MACHINE_SITE_NATS_USER: 'gw', MACHINE_SITE_NATS_PASSWORD: 'pw', MACHINE_QUIET_MS: '0', MACHINE_DISPATCH_TTL_MS: '1000',
    });
    expect(c).toMatchObject({ siteNatsUser: 'gw', siteNatsPassword: 'pw', quietMs: 0, dispatchTtlMs: 1000 });
  });

  it('nats needs the site NATS and the MQTT endpoint, and defaults to the jetstream feed on MQTT 3.1.1', () => {
    expect(() => loadMachineLineConfig({ MACHINE_TRANSPORT: 'nats' })).toThrow(/MACHINE_SITE_NATS_URL/);
    expect(() => loadMachineLineConfig({ MACHINE_TRANSPORT: 'nats', MACHINE_SITE_NATS_URL: 'nats://site:4222' })).toThrow(/MACHINE_MQTT_URL/);
    const c = loadMachineLineConfig({ MACHINE_TRANSPORT: 'nats', MACHINE_SITE_NATS_URL: 'nats://site:4222', MACHINE_MQTT_URL: 'mqtts://site:8883' });
    expect(c.feed).toBe('jetstream');
    expect(c.mqtt?.protocolVersion).toBe(4);
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

  it('names one Long Tail role per process', () => {
    expect(stationRole('trim')).toBe('line-trim');
    expect(stationRole('final_check')).toBe('line-final-check');
  });
});
