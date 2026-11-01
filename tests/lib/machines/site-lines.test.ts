import { describe, it, expect } from 'vitest';
import { join } from 'path';

import { loadLine, loadLines } from '../../../lib/machines/line';
import { renderSiteConf } from '../../../lib/machines/site/site-conf';
import { renderMosquittoAcl, renderMosquittoConf } from '../../../lib/machines/site/mosquitto-conf';
import { genericCodec } from '../../../lib/machines/protocol/codec';

const EXAMPLE = join(__dirname, '../../../examples/workflows/machine-line');
const NORTH = join(EXAMPLE, 'factory-line.json');
const SOUTH = join(EXAMPLE, 'factory-line-south.json');
const SITE = { root: 'line/v1', gatewayUser: 'line-gateway', gatewayPassword: 'gwpw', certDir: '/etc/site/certs', storeDir: '/data' };
const BROKER = { root: 'line/v1', certDir: '/certs', siteNats: 'site-nats:8883', aclFile: '/mosquitto/config/acl' };

// Two sites, each with a line, on one broker and one site NATS.

describe('several lines on one site', () => {
  const lines = loadLines(`${NORTH}, ${SOUTH}`);

  it('MACHINE_LINE_CONFIG names one file or several, each site and line once', () => {
    expect(lines.map((l) => `${l.siteId}/${l.lineId}`)).toEqual(['site-1/line-1', 'site-2/line-1']);
    expect(loadLines(NORTH)).toEqual([loadLine(NORTH)]);
    expect(() => loadLines(`${NORTH},${NORTH}`)).toThrow(/declared twice/);
    expect(() => loadLines('')).toThrow(/no line definition/);
    expect(loadLines(undefined, lines[1])).toEqual([lines[1]]);
  });

  it('one line renders exactly as before', () => {
    expect(renderSiteConf([lines[0]], SITE)).toBe(renderSiteConf(lines[0], SITE));
    expect(renderMosquittoConf([lines[0]], BROKER)).toBe(renderMosquittoConf(lines[0], BROKER));
    const codec = genericCodec({ root: 'line/v1' });
    expect(renderMosquittoAcl([lines[0]], codec)).toBe(renderMosquittoAcl(lines[0], codec));
  });

  it('the site NATS admits each line\'s bridge and lets the gateway read every line', () => {
    const conf = renderSiteConf(lines, SITE);
    expect(conf).toContain('server_name: "site"');
    expect(conf).toContain('{ user: "CN=site-1-line-1-bridge", allowed_connection_types: ["MQTT"],');
    expect(conf).toContain('{ user: "CN=site-2-line-1-bridge", allowed_connection_types: ["MQTT"],');
    expect(conf).toContain('permissions: { publish: ["line.v1.site-2.line-1.>"], subscribe: { deny: [">"] } }');
    expect(conf).toContain('subscribe: ["_INBOX.>","line.v1.site-1.line-1.>","line.v1.site-2.line-1.>"] }');
    expect(conf).toContain('"$JS.API.CONSUMER.MSG.NEXT.LINE_EVENTS.line-controller-site-1-line-1-events"');
    expect(conf).toContain('"$JS.API.CONSUMER.MSG.NEXT.LINE_EVENTS.line-controller-site-2-line-1-events"');
    expect(conf.match(/{ user: "line-gateway"/g)).toHaveLength(1);
    expect(conf.match(/"\$JS.API.STREAM.UPDATE.LINE_EVENTS"/g)).toHaveLength(1);
  });

  it('names the server for the site when every line shares one', () => {
    const twin = { ...lines[1], siteId: 'site-1', lineId: 'line-2' };
    expect(renderSiteConf([lines[0], twin], SITE)).toContain('server_name: "site-1"');
  });

  it('the broker bridges each line out under its own identity', () => {
    const conf = renderMosquittoConf(lines, BROKER);
    expect(conf.match(/^listener 8883$/gm)).toHaveLength(1);
    expect(conf).toContain('connection site-1-line-1-site-nats');
    expect(conf).toContain('connection site-2-line-1-site-nats');
    expect(conf).toContain('bridge_certfile /certs/site-2-line-1-bridge.pem');
    expect(conf).toContain('topic line/v1/site-2/line-1/# out 1');
  });

  it('the ACL gives each line its machines and its own controller', () => {
    const acl = renderMosquittoAcl(lines, genericCodec({ root: 'line/v1' }));
    expect(acl).toContain('user site-1-line-1-press-01');
    expect(acl).toContain('user site-2-line-1-press-21');
    expect(acl).toContain('topic write line/v1/site-2/line-1/press-21/job');
    expect(acl).toContain('user line-controller-site-1-line-1');
    expect(acl).toContain('user line-controller-site-2-line-1');
    expect(acl).toContain('topic read line/v1/site-2/line-1/#');
    expect(acl.match(/# Rendered from/g)).toHaveLength(1);
  });
});
