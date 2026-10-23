import { describe, it, expect } from 'vitest';

import { DEFAULT_LINE } from '../../../examples/workflows/machine-line/line';
import { renderMosquittoAcl, renderMosquittoConf } from '../../../lib/machines/site/mosquitto-conf';
import { genericCodec } from '../../../lib/machines/protocol/codec';

const conf = renderMosquittoConf(DEFAULT_LINE, { root: 'line/v1', certDir: '/certs', siteNats: 'site-nats:8883', aclFile: '/mosquitto/config/acl' });
const acl = renderMosquittoAcl(DEFAULT_LINE, genericCodec({ root: 'line/v1' }));

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

  it('takes its topics from the codec, so another protocol gets its own ACL', () => {
    const other = renderMosquittoAcl(DEFAULT_LINE, {
      root: 'cell/v2', channels: { events: ['state', 'unit/+'], telemetry: ['readings/#'], commands: ['control'] },
    });
    const press = other.split('\n\n').find((b) => b.includes('user site-1-line-1-press-01'))!;
    expect(press).toContain('topic write cell/v2/site-1/line-1/press-01/state');
    expect(press).toContain('topic write cell/v2/site-1/line-1/press-01/unit/+');
    expect(press).toContain('topic write cell/v2/site-1/line-1/press-01/readings/#');
    expect(press).toContain('topic read cell/v2/site-1/line-1/press-01/control');
    expect(press).not.toContain('/job');
    const ctl = other.split('\n\n').find((b) => b.includes('user line-controller-site-1-line-1'))!;
    expect(ctl).toContain('topic write cell/v2/site-1/line-1/+/control');
  });

  it('follows the codec\'s layout and each machine\'s wire address', () => {
    const line = { ...DEFAULT_LINE, machines: DEFAULT_LINE.machines.map((m, i) => (i === 0 ? { ...m, address: '8f77e321' } : m)) };
    const acl = renderMosquittoAcl(line, {
      root: 'acme/v1',
      channels: { events: ['events'], telemetry: ['telemetry'], commands: ['commands'] },
      topicFor: (s, c) => `acme/v1/${s.siteId ?? '+'}/${s.lineId ?? '+'}/${c === 'commands' ? 'down' : 'up'}/${s.address ?? '+'}/${c}`,
    });
    const press = acl.split('\n\n').find((b) => b.includes('user site-1-line-1-8f77e321'))!;
    expect(press).toContain('topic write acme/v1/site-1/line-1/up/8f77e321/events');
    expect(press).toContain('topic read acme/v1/site-1/line-1/down/8f77e321/commands');
    const ctl = acl.split('\n\n').find((b) => b.includes('user line-controller-site-1-line-1'))!;
    expect(ctl).toContain('topic write acme/v1/site-1/line-1/down/+/commands');
    expect(ctl).toContain('topic read acme/v1/site-1/line-1/#');
  });
});

describe('machine broker ACL, a line that learns addresses', () => {
  const learned = renderMosquittoAcl({ ...DEFAULT_LINE, addressing: 'learned' }, genericCodec({ root: 'line/v1' }));

  it('gives every certificate its own channels by common name, before any user block, and no user per station', () => {
    expect(learned.indexOf('pattern write line/v1/site-1/line-1/%u/job')).toBeGreaterThan(-1);
    expect(learned).toContain('pattern read line/v1/site-1/line-1/%u/cmd');
    expect(learned.indexOf('pattern ')).toBeLessThan(learned.indexOf('user '));
    expect(learned).not.toContain('user site-1-line-1-press-01');
    expect(learned).toContain('user line-controller-site-1-line-1');
  });

  it('a station whose address is declared keeps its own user block', () => {
    const [press, ...rest] = DEFAULT_LINE.machines;
    const mixed = renderMosquittoAcl({ ...DEFAULT_LINE, addressing: 'learned', machines: [{ ...press, address: '8f77e321' }, ...rest] }, genericCodec({ root: 'line/v1' }));
    expect(mixed).toContain('user site-1-line-1-8f77e321');
    expect(mixed).toContain('pattern write line/v1/site-1/line-1/%u/job');
  });

  it('denies a declared station\'s channels to a certificate named for its address', () => {
    const [press, ...rest] = DEFAULT_LINE.machines;
    const mixed = renderMosquittoAcl({ ...DEFAULT_LINE, addressing: 'learned', machines: [{ ...press, address: '8f77e321' }, ...rest] }, genericCodec({ root: 'line/v1' }));
    const shadow = mixed.split('\n\n').find((b) => b.startsWith('user 8f77e321\n'))!;
    expect(shadow).toContain('topic deny line/v1/site-1/line-1/8f77e321/job');
    expect(shadow).toContain('topic deny line/v1/site-1/line-1/8f77e321/cmd');
    expect(shadow).not.toMatch(/topic (read|write) /);
    expect(learned).not.toContain('topic deny');
  });

  it('refuses a declared address that is also a broker user name', () => {
    const [press, ...rest] = DEFAULT_LINE.machines;
    const line = { ...DEFAULT_LINE, addressing: 'learned' as const, machines: [{ ...press, address: 'line-controller-site-1-line-1' }, ...rest] };
    expect(() => renderMosquittoAcl(line, genericCodec({ root: 'line/v1' }))).toThrow(/broker user name/);
  });
});
