/**
 * Prepare the site: a development CA; server certificates for the machine
 * broker and the site NATS; client certificates for each machine, the
 * gateway and the bridge; and site.conf, mosquitto.conf and the broker ACL
 * rendered from the line. Certificates already on disk are kept; the
 * configuration is rendered again on every run.
 *
 *   MACHINE_SITE_DIR=deploy/machine-site npx ts-node examples/workflows/machine-line/site/setup.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { loadMachineLineConfig } from '../../../../services/machines/config';
import { clientIds, controllerId } from '../../../../lib/machines/line';
import { loadLine } from '../line';
import { bridgeId, renderSiteConf } from '../../../../lib/machines/site/site-conf';
import { renderMosquittoAcl, renderMosquittoConf } from '../../../../lib/machines/site/mosquitto-conf';
import { genericCodec } from '../../../../lib/machines/protocol/codec';

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

function main(): void {
  // 1. Line and output directory
  const config = loadMachineLineConfig({ ...process.env, MACHINE_TRANSPORT: 'memory', MACHINE_ESCALATION_FEED: 'memory' });
  const line = loadLine(config.lineConfigPath);
  const dir = process.env.MACHINE_SITE_DIR ?? 'deploy/machine-site';
  const certDir = join(dir, 'certs');
  const brokerDir = join(dir, 'mosquitto');
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
  const conf = renderSiteConf(line, {
    root: config.topicRoot,
    gatewayUser: process.env.MACHINE_SITE_NATS_USER ?? 'line-gateway',
    gatewayPassword: process.env.MACHINE_SITE_NATS_PASSWORD ?? 'dev_gateway_secret',
    certDir: process.env.MACHINE_SITE_CERT_MOUNT ?? '/etc/site/certs',
    storeDir: '/data',
  });
  writeFileSync(join(dir, 'site.conf'), conf);
  writeFileSync(join(brokerDir, 'mosquitto.conf'), renderMosquittoConf(line, {
    root: config.topicRoot, certDir: '/certs', siteNats: process.env.MACHINE_SITE_NATS_MQTT ?? 'site-nats:8883', aclFile: '/mosquitto/config/acl',
  }));
  writeFileSync(join(brokerDir, 'acl'), renderMosquittoAcl(line, genericCodec({ root: config.topicRoot })));
  console.log(JSON.stringify({ level: 'info', event: 'machine_site.ready', dir, identities: clientIds(line).length + 2 }));
}

main();
