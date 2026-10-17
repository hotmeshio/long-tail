import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { mqttOptions } from '../../../examples/workflows/machine-line/transport';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtt-opts-'));
  writeFileSync(join(dir, 'ca.pem'), 'CA');
  writeFileSync(join(dir, 'site-1-line-1-press-01.pem'), 'PRESS-CERT');
  writeFileSync(join(dir, 'site-1-line-1-press-01.key'), 'PRESS-KEY');
});

describe('MQTT client options', () => {
  it('picks each identity\'s certificate through {clientId} and keeps the session across reconnects', () => {
    const o = mqttOptions({ url: 'mqtts://site:8883', protocolVersion: 4, caFile: join(dir, 'ca.pem'), certFile: join(dir, '{clientId}.pem'), keyFile: join(dir, '{clientId}.key') }, 'site-1-line-1-press-01');
    expect(String(o.ca)).toBe('CA');
    expect(String(o.cert)).toBe('PRESS-CERT');
    expect(String(o.key)).toBe('PRESS-KEY');
    expect(o).toMatchObject({ clientId: 'site-1-line-1-press-01', clean: false, protocolVersion: 4 });
    expect(o.properties).toBeUndefined();
  });

  it('MQTT 5 asks the broker to keep the session after a disconnect', () => {
    const o = mqttOptions({ url: 'mqtt://b', protocolVersion: 5 }, 'gw');
    expect(o.properties?.sessionExpiryInterval).toBeGreaterThan(0);
  });

  it('sends the will at QoS 1 and fills {clientId} in a username', () => {
    const o = mqttOptions({ url: 'mqtt://b', protocolVersion: 4, username: 'u-{clientId}', password: 'pw' }, 'm1', { topic: 't/presence', payload: '{"online":false}', retain: true });
    expect(o.username).toBe('u-m1');
    expect(o.will).toMatchObject({ topic: 't/presence', qos: 1, retain: true });
    expect(String(o.will?.payload)).toBe('{"online":false}');
  });

  it('a missing certificate file throws instead of connecting without it', () => {
    expect(() => mqttOptions({ url: 'mqtts://b', protocolVersion: 4, certFile: join(dir, 'nobody.pem') }, 'x')).toThrow(/ENOENT/);
  });
});
