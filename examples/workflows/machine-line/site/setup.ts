/**
 * Prepare the site broker: a development CA, the broker's server
 * certificate, one client certificate per machine plus the gateway's, and
 * site.conf rendered from the line. Certificates already on disk are kept;
 * site.conf is rendered again on every run.
 *
 *   MACHINE_SITE_DIR=deploy/machine-site npx ts-node examples/workflows/machine-line/site/setup.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { loadMachineLineConfig } from '../config';
import { clientIds, controllerId, loadLine } from '../line';
import { renderSiteConf } from './site-conf';

const DAYS = '825';
const SERVER_NAMES = (process.env.MACHINE_SITE_HOSTNAMES ?? 'site-nats,localhost').split(',');

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
  mkdirSync(certDir, { recursive: true });

  // 2. Development CA, broker certificate, one client certificate per identity
  if (!existsSync(join(certDir, 'ca.pem'))) {
    openssl(certDir, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', DAYS, '-subj', '/CN=machine-line-dev-ca', '-keyout', 'ca.key', '-out', 'ca.pem');
  }
  const sans = SERVER_NAMES.map((n) => `DNS:${n}`).concat('IP:127.0.0.1').join(',');
  issue(certDir, 'server', SERVER_NAMES[0], `subjectAltName=${sans}\nextendedKeyUsage=serverAuth\n`);
  for (const id of [...clientIds(line), controllerId(line)]) issue(certDir, id, id, 'extendedKeyUsage=clientAuth\n');

  // 3. site.conf
  const conf = renderSiteConf(line, {
    root: config.topicRoot,
    hubLeafUrl: process.env.MACHINE_HUB_LEAF_URL ?? 'nats-leaf://site-leaf:dev_leaf_secret@nats:7422',
    gatewayUser: process.env.MACHINE_SITE_NATS_USER ?? 'line-gateway',
    gatewayPassword: process.env.MACHINE_SITE_NATS_PASSWORD ?? 'dev_gateway_secret',
    certDir: process.env.MACHINE_SITE_CERT_MOUNT ?? '/etc/site/certs',
    storeDir: '/data',
  });
  writeFileSync(join(dir, 'site.conf'), conf);
  console.log(JSON.stringify({ level: 'info', event: 'machine_site.ready', dir, identities: clientIds(line).length + 1 }));
}

main();
