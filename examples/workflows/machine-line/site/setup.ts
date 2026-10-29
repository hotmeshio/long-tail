/**
 * Prepare the site: a development CA; server certificates for the machine
 * broker and the site NATS; client certificates for each machine, the
 * gateway and the bridge; and site.conf, mosquitto.conf and the broker ACL
 * rendered from the line. Certificates already on disk are kept; the
 * configuration is rendered again on every run.
 *
 * With MACHINE_LINE_ADDRESSES (station → permanent address) the line learns
 * its addresses: each machine's certificate names its address as its CN, the
 * ACL gives every certificate its own channels by that name, and line.json,
 * the line as Long Tail knows it (stations only), is written beside site.conf.
 *
 *   MACHINE_SITE_DIR=deploy/machine-site npx ts-node examples/workflows/machine-line/site/setup.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { loadMachineLineConfig } from '../../../../services/machines/config';
import { clientIds, controllerId, identOf, type LineDef } from '../../../../lib/machines/line';
import { clientIdOf } from '../../../../lib/machines/protocol/envelope';
import { learnedLine, loadLine, readAddresses, withAddresses } from '../line';
import { bridgeId, renderSiteConf } from '../../../../lib/machines/site/site-conf';
import { renderMosquittoAcl, renderMosquittoConf } from '../../../../lib/machines/site/mosquitto-conf';
import { genericCodec, type LineCodec } from '../../../../lib/machines/protocol/codec';

const DAYS = '825';
const NATS_NAMES = ['site-nats', 'localhost'];
const BROKER_NAMES = (process.env.MACHINE_BROKER_HOSTNAMES ?? 'machine-broker,localhost').split(',');
const sansOf = (names: string[]) => names.map((n) => `DNS:${n}`).concat('IP:127.0.0.1').join(',');

function openssl(dir: string, ...args: string[]): void {
  execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
}

function issue(dir: string, name: string, cn: string, extensions: string): void {
  if (existsSync(join(dir, `${name}.pem`))) return;
  writeFileSync(join(dir, `${name}.ext`), extensions);
  openssl(dir, 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${cn}`, '-keyout', `${name}.key`, '-out', `${name}.csr`);
  openssl(dir, 'x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
    '-days', DAYS, '-extfile', `${name}.ext`, '-out', `${name}.pem`);
}

export interface SiteOptions {
  /** Where the site's certificates and configuration are written. */
  dir: string;
  root: string;
  /** Decides the ACL's topics; the generic line protocol when absent. */
  codec?: Pick<LineCodec, 'root' | 'channels' | 'topicFor'>;
  /** Appended to mosquitto.conf, e.g. bridges to brokers the machines host themselves. */
  brokerExtra?: string;
}

/** The development CA, server and client certificates, site.conf, and the broker's mosquitto.conf and ACL for `line`. */
export function prepareSite(line: LineDef, opts: SiteOptions): { certDir: string } {
  // 1. Output directories
  const certDir = join(opts.dir, 'certs');
  const brokerDir = join(opts.dir, 'mosquitto');
  mkdirSync(certDir, { recursive: true });
  mkdirSync(brokerDir, { recursive: true });

  // 2. Development CA, broker certificate, one client certificate per identity
  if (!existsSync(join(certDir, 'ca.pem'))) {
    openssl(certDir, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', DAYS, '-subj', '/CN=machine-line-dev-ca', '-keyout', 'ca.key', '-out', 'ca.pem');
  }
  issue(certDir, 'server', NATS_NAMES[0], `subjectAltName=${sansOf(NATS_NAMES)}\nextendedKeyUsage=serverAuth\n`);
  issue(certDir, 'broker', BROKER_NAMES[0], `subjectAltName=${sansOf(BROKER_NAMES)}\nextendedKeyUsage=serverAuth\n`);
  for (const id of [...clientIds(line), controllerId(line), bridgeId(line)]) issue(certDir, id, id, 'extendedKeyUsage=clientAuth\n');

  // 3. site.conf for the site NATS, mosquitto.conf and acl for the machine broker
  writeFileSync(join(opts.dir, 'site.conf'), renderSiteConf(line, {
    root: opts.root,
    gatewayUser: process.env.MACHINE_SITE_NATS_USER ?? 'line-gateway',
    gatewayPassword: process.env.MACHINE_SITE_NATS_PASSWORD ?? 'dev_gateway_secret',
    certDir: process.env.MACHINE_SITE_CERT_MOUNT ?? '/etc/site/certs',
    storeDir: '/data',
  }));
  const brokerConf = renderMosquittoConf(line, {
    root: opts.root, certDir: '/certs', siteNats: process.env.MACHINE_SITE_NATS_MQTT ?? 'site-nats:8883', aclFile: '/mosquitto/config/acl',
  });
  writeFileSync(join(brokerDir, 'mosquitto.conf'), opts.brokerExtra ? `${brokerConf}\n${opts.brokerExtra}` : brokerConf);
  writeFileSync(join(brokerDir, 'acl'), renderMosquittoAcl(line, opts.codec ?? genericCodec({ root: opts.root })));
  return { certDir };
}

function main(): void {
  const config = loadMachineLineConfig({ ...process.env, MACHINE_TRANSPORT: 'memory', MACHINE_ESCALATION_FEED: 'memory' });
  const addresses = readAddresses(process.env.MACHINE_LINE_ADDRESSES);
  const machines = withAddresses(loadLine(config.lineConfigPath), addresses);
  const line = addresses ? learnedLine(machines) : machines;
  const dir = process.env.MACHINE_SITE_DIR ?? 'deploy/machine-site';
  const { certDir } = prepareSite(line, { dir, root: config.topicRoot });
  // A machine whose address the line learns is known to the broker by its address alone.
  if (addresses) {
    for (const m of machines.machines) issue(certDir, clientIdOf(identOf(machines, m.machineId)), m.address!, 'extendedKeyUsage=clientAuth\n');
    writeFileSync(join(dir, 'line.json'), `${JSON.stringify(line, null, 2)}\n`);
  }
  const identities = (addresses ? machines.machines.length : clientIds(line).length) + 2;
  console.log(JSON.stringify({ level: 'info', event: 'machine_site.ready', dir, identities, addressing: line.addressing ?? 'declared' }));
}

if (require.main === module) main();
