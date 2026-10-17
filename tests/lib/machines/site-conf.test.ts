import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { bridgeId, renderSiteConf } from '../../../lib/machines/site/site-conf';

const conf = renderSiteConf(DEFAULT_LINE, {
  root: 'line/v1', hubLeafUrl: 'nats-leaf://site-leaf:pw@nats:7422', gatewayUser: 'line-gateway', gatewayPassword: 'gwpw',
  certDir: '/etc/site/certs', storeDir: '/data',
});

describe('site NATS config', () => {
  it('lets only the machine broker\'s bridge in over MQTT, publishing under the line', () => {
    expect(bridgeId(DEFAULT_LINE)).toBe('site-1-line-1-bridge');
    expect(conf).toContain('{ user: "CN=site-1-line-1-bridge", allowed_connection_types: ["MQTT"],');
    expect(conf).toContain('permissions: { publish: ["line.v1.site-1.line-1.>"], subscribe: { deny: [">"] } }');
    expect(conf).not.toContain('CN=site-1-line-1-press-01');
  });

  it('lets the gateway read the streams by password', () => {
    expect(conf).toContain('{ user: "line-gateway", password: "gwpw", allowed_connection_types: ["STANDARD"] }');
  });

  it('runs JetStream, MQTT over TLS with certificate login, and a leafnode to Long Tail', () => {
    expect(conf).toContain('jetstream { store_dir: "/data" }');
    expect(conf).toMatch(/mqtt \{\s+port: 8883/);
    expect(conf).toContain('verify_and_map: true');
    expect(conf).toContain('remotes: [ { url: "nats-leaf://site-leaf:pw@nats:7422" } ]');
  });
});
