import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { MachineSurface, surfaceConfig } from '../../../services/machines/surface';

const SITE = { MACHINE_SITE_NATS_URL: 'nats://site:4222', MACHINE_MQTT_URL: 'mqtts://broker:8883' };

describe('machine surface configuration', () => {
  it('reads escalation events in process on either transport', () => {
    expect(surfaceConfig({ MACHINE_TRANSPORT: 'nats', ...SITE }).feed).toBe('in-process');
    expect(surfaceConfig({ MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtts://broker:8883' }).feed).toBe('in-process');
  });

  it('keeps an explicit feed choice', () => {
    expect(surfaceConfig({ MACHINE_TRANSPORT: 'nats', MACHINE_ESCALATION_FEED: 'core', NATS_URL: 'nats://lt:4222', ...SITE }).feed).toBe('core');
  });

  it('refuses the memory transport and a missing transport', () => {
    expect(() => surfaceConfig({})).toThrow(/MACHINE_TRANSPORT=nats or mqtt/);
    expect(() => surfaceConfig({ MACHINE_TRANSPORT: 'memory' })).toThrow(/MACHINE_TRANSPORT=nats or mqtt/);
  });

  it('refuses an incomplete transport, and starts empty until the registry fills it', async () => {
    expect(() => MachineSurface.start({ lines: [DEFAULT_LINE], env: { MACHINE_TRANSPORT: 'mqtt' } })).toThrow(/MACHINE_MQTT_URL/);
    const surface = MachineSurface.start({ lines: [], env: { MACHINE_TRANSPORT: 'mqtt', MACHINE_MQTT_URL: 'mqtt://b' } });
    expect(surface.describeLines()).toEqual([]);
    expect(surface.findLine('site-1', 'line-1')).toBeUndefined();
    expect(surface.commandOps('site-1', 'line-1')).toEqual([]);
    expect(await surface.retire('site-1', 'line-1')).toBe(false);
    await surface.stop();
  });
});
