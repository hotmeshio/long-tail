import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { MachineSurface, surfaceConfig } from '../../../services/machines/surface';

const SITE = { MACHINE_SITE_NATS_URL: 'nats://site:4222', MACHINE_MQTT_URL: 'mqtts://broker:8883' };

describe('machine surface configuration', () => {
  it('reads escalation events from the site stream when the line runs on NATS', () => {
    expect(surfaceConfig({ MACHINE_TRANSPORT: 'nats', ...SITE }).feed).toBe('jetstream');
  });

  it('reads escalation events in process when the line runs on a plain MQTT broker', () => {
    expect(surfaceConfig({ MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtts://broker:8883' }).feed).toBe('in-process');
  });

  it('keeps an explicit feed choice', () => {
    expect(surfaceConfig({ MACHINE_TRANSPORT: 'nats', MACHINE_ESCALATION_FEED: 'in-process', ...SITE }).feed).toBe('in-process');
  });

  it('refuses the memory transport and a missing transport', () => {
    expect(() => surfaceConfig({})).toThrow(/MACHINE_TRANSPORT=nats or mqtt/);
    expect(() => surfaceConfig({ MACHINE_TRANSPORT: 'memory' })).toThrow(/MACHINE_TRANSPORT=nats or mqtt/);
  });

  it('refuses to start with no lines or an incomplete transport', () => {
    expect(() => MachineSurface.start({ lines: [], env: { MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtt://b' } })).toThrow(/at least one line/);
    expect(() => MachineSurface.start({ lines: [DEFAULT_LINE], env: { MACHINE_TRANSPORT: 'mqtt' } })).toThrow(/MACHINE_MQTT_URL/);
  });
});
