import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { renderMosquittoAcl, renderMosquittoConf } from '../../../lib/machines/site/mosquitto-conf';

const conf = renderMosquittoConf(DEFAULT_LINE, { root: 'line/v1', certDir: '/certs', siteNats: 'site-nats:8883', aclFile: '/mosquitto/config/acl' });
const acl = renderMosquittoAcl(DEFAULT_LINE, 'line/v1');

describe('machine broker config', () => {
  it('requires a client certificate and takes its CN as the username', () => {
    expect(conf).toContain('require_certificate true');
    expect(conf).toContain('use_identity_as_username true');
    expect(conf).toContain('max_packet_size 262144');
  });

  it('bridges the line\'s topics out to the site NATS as the bridge identity, MQTT 3.1.1', () => {
    expect(conf).toContain('address site-nats:8883');
    expect(conf).toContain('bridge_protocol_version mqttv311');
    expect(conf).toContain('bridge_certfile /certs/site-1-line-1-bridge.pem');
    expect(conf).toContain('topic line/v1/site-1/line-1/# out 1');
    expect(conf).toContain('notifications false');
  });
});

describe('machine broker ACL', () => {
  it('lets a machine write only its own channels and read only its own commands', () => {
    const press = acl.split('\n\n').find((b) => b.includes('user site-1-line-1-press-01'))!;
    expect(press).toContain('topic write line/v1/site-1/line-1/press-01/job');
    expect(press).toContain('topic write line/v1/site-1/line-1/press-01/alarm/+');
    expect(press).toContain('topic read line/v1/site-1/line-1/press-01/cmd');
    expect(press).not.toContain('topic write line/v1/site-1/line-1/press-01/cmd\n');
    expect(press).not.toContain('cut-01');
  });

  it('lets the controller command every machine on the line and read the line', () => {
    const ctl = acl.split('\n\n').find((b) => b.includes('user line-controller-site-1-line-1'))!;
    expect(ctl).toContain('topic write line/v1/site-1/line-1/+/cmd');
    expect(ctl).toContain('topic read line/v1/site-1/line-1/#');
  });
});
