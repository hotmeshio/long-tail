import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { renderSiteConf } from '../../../lib/machines/site/site-conf';

const conf = renderSiteConf(DEFAULT_LINE, {
  root: 'line/v1', hubLeafUrl: 'nats-leaf://site-leaf:pw@nats:7422', gatewayUser: 'line-gateway', gatewayPassword: 'gwpw',
  certDir: '/etc/site/certs', storeDir: '/data',
});

describe('site broker config', () => {
  it('maps each machine certificate to a user that publishes only under its own topics', () => {
    expect(conf).toContain('{ user: "CN=site-1-line-1-press-01", allowed_connection_types: ["MQTT"],');
    expect(conf).toContain('publish: { allow: ["line.v1.site-1.line-1.press-01.>"], deny: ["line.v1.site-1.line-1.press-01.cmd"] }');
    expect(conf).toContain('subscribe: { allow: ["line.v1.site-1.line-1.press-01.cmd"] }');
    expect(conf.match(/CN=site-1-line-1-/g)).toHaveLength(3);
  });

  it('lets the controller command every machine on the line and the gateway read the streams', () => {
    expect(conf).toContain('{ user: "CN=line-controller-site-1-line-1"');
    expect(conf).toContain('publish: ["line.v1.site-1.line-1.*.cmd"], subscribe: ["line.v1.site-1.line-1.>"]');
    expect(conf).toContain('{ user: "line-gateway", password: "gwpw", allowed_connection_types: ["STANDARD"] }');
  });

  it('runs JetStream, MQTT over TLS with certificate login, and a leafnode to Long Tail', () => {
    expect(conf).toContain('jetstream { store_dir: "/data" }');
    expect(conf).toMatch(/mqtt \{\s+port: 8883/);
    expect(conf).toContain('verify_and_map: true');
    expect(conf).toContain('ca_file: "/etc/site/certs/ca.pem"');
    expect(conf).toContain('remotes: [ { url: "nats-leaf://site-leaf:pw@nats:7422" } ]');
  });
});
