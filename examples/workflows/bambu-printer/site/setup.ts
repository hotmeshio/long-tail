/**
 * Prepare the site for the printers in .env: the machine-line site (CA,
 * certificates, site.conf, the broker's configuration and ACL) for a line of
 * the enabled printers, one bridge per printer appended to mosquitto.conf,
 * each printer's CA read from the printer itself, and line.json, the line as
 * Long Tail knows it.
 *
 *   MACHINE_SITE_DIR=deploy/bambu-site npx ts-node examples/workflows/bambu-printer/site/setup.ts
 */

import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { connect, type PeerCertificate } from 'tls';

import { prepareSite } from '../../machine-line/site/setup';
import { bambuCodec } from '../codec';
import { PRINTER_ACCESS, bambuLine, printersFromEnv, type BambuPrinter } from '../env';
import { printerCaFile, renderPrinterBridges } from './bridge';

const CERT_MOUNT = '/certs';

/** The root of the chain the printer presents, as PEM. */
function readPrinterCa(printer: BambuPrinter): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: printer.host, port: PRINTER_ACCESS.MQTT_PORT, rejectUnauthorized: false, timeout: 8_000 }, () => {
      let cert: PeerCertificate = socket.getPeerCertificate(true);
      while (cert.issuerCertificate && cert.issuerCertificate !== cert) cert = cert.issuerCertificate;
      socket.end();
      const body = cert.raw.toString('base64').match(/.{1,64}/g)!.join('\n');
      resolve(`-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`);
    });
    socket.on('timeout', () => socket.destroy(new Error(`${printer.station} at ${printer.host}:${PRINTER_ACCESS.MQTT_PORT} did not answer`)));
    socket.on('error', reject);
  });
}

async function main(): Promise<void> {
  // 1. The line of enabled printers
  const printers = printersFromEnv();
  const line = bambuLine(printers);
  const root = process.env.MACHINE_TOPIC_ROOT || 'line/v1';
  const dir = process.env.MACHINE_SITE_DIR ?? 'deploy/bambu-site';

  // 2. The machine-line site, with a bridge to each printer
  const { certDir } = prepareSite(line, {
    dir, root, codec: bambuCodec({ root, line }),
    brokerExtra: renderPrinterBridges(line, printers, { root, certDir: CERT_MOUNT }),
  });

  // 3. Each bridged printer's CA, read once from the printer
  const bridged = printers.filter((p) => line.machines.some((m) => m.machineId === p.station));
  for (const printer of bridged) {
    const file = join(certDir, printerCaFile('.', printer.serial));
    if (!existsSync(file)) writeFileSync(file, await readPrinterCa(printer));
  }
  writeFileSync(join(dir, 'line.json'), `${JSON.stringify(line, null, 2)}\n`);
  console.log(JSON.stringify({ level: 'info', event: 'bambu_site.ready', dir, printers: bridged.map((p) => p.station) }));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', event: 'bambu_site.failed', error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
