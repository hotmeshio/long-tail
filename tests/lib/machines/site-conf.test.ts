import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { bridgeId, renderSiteConf } from '../../../lib/machines/site/site-conf';

const conf = renderSiteConf(DEFAULT_LINE, {
  root: 'line/v1', gatewayUser: 'line-gateway', gatewayPassword: 'gwpw', certDir: '/etc/site/certs', storeDir: '/data',
});

describe('site NATS config', () => {
  it('lets only the machine broker\'s bridge in over MQTT, publishing under the line', () => {
    expect(bridgeId(DEFAULT_LINE)).toBe('site-1-line-1-bridge');
    expect(conf).toContain('{ user: "CN=site-1-line-1-bridge", allowed_connection_types: ["MQTT"],');
    expect(conf).toContain('permissions: { publish: ["line.v1.site-1.line-1.>"], subscribe: { deny: [">"] } }');
    expect(conf).not.toContain('CN=site-1-line-1-press-01');
  });

  it('lets the gateway keep and read only its streams through its own consumer, by password', () => {
    expect(conf).toContain('{ user: "line-gateway", password: "gwpw", allowed_connection_types: ["STANDARD"],');
    expect(conf).toContain('subscribe: ["_INBOX.>","line.v1.site-1.line-1.>"] }');
    expect(conf).toContain('"$JS.API.STREAM.UPDATE.LINE_EVENTS"');
    expect(conf).toContain('"$JS.API.CONSUMER.MSG.NEXT.LINE_EVENTS.line-controller-site-1-line-1-events"');
    expect(conf).toContain('"$JS.ACK.LINE_EVENTS.line-controller-site-1-line-1-events.>"');
    expect(conf).not.toContain('"$JS.API.>"');
    expect(conf).not.toContain('STREAM.DELETE');
  });

  it('runs JetStream and MQTT over TLS with certificate login, as a server of its own', () => {
    expect(conf).toContain('jetstream { store_dir: "/data" }');
    expect(conf).toMatch(/mqtt \{\s+port: 8883/);
    expect(conf).toContain('verify_and_map: true');
    expect(conf).not.toMatch(/leafnodes/);
  });
});
