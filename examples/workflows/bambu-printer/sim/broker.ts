/**
 * What the simulated printer's broker needs, written to one directory: a CA
 * and a server certificate issued to the printer's serial, served with its
 * chain (as a printer's is), a Mosquitto password file for bblp and the
 * access code, and the broker's configuration. Certificates already on disk
 * are kept.
 */

import { execFileSync } from 'child_process';
import { pbkdf2Sync, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { PRINTER_ACCESS } from '../env';

const DAYS = '825';
/** Mosquitto's `$7$` password hash: PBKDF2-SHA512, 101 iterations, a 12-byte salt. */
const PW_ITERATIONS = 101;
const PW_SALT_BYTES = 12;
const PW_HASH_BYTES = 64;

function openssl(dir: string, ...args: string[]): void {
  execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
}

/** One line of a Mosquitto password file. */
export function passwordLine(user: string, password: string, salt = randomBytes(PW_SALT_BYTES)): string {
  const hash = pbkdf2Sync(password, salt, PW_ITERATIONS, PW_HASH_BYTES, 'sha512');
  return `${user}:$7$${PW_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** The broker's configuration, with its files where the broker mounts `dir`. */
export function renderSimBrokerConf(mount: string): string {
  return `per_listener_settings false
allow_anonymous false
password_file ${mount}/passwd
persistence false
log_dest stdout
listener ${PRINTER_ACCESS.MQTT_PORT}
cafile ${mount}/ca.pem
certfile ${mount}/printer-chain.pem
keyfile ${mount}/printer.key
`;
}

/** Write the CA, the printer's certificate, the password file and mosquitto.conf; returns the key and certificate chain, for FTPS. */
export function prepareSimBroker(dir: string, opts: { serial: string; code: string; mount: string }): { key: Buffer; cert: Buffer } {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, 'ca.pem'))) {
    openssl(dir, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', DAYS, '-subj', '/CN=printer-sim-ca', '-keyout', 'ca.key', '-out', 'ca.pem');
  }
  if (!existsSync(join(dir, 'printer.pem'))) {
    writeFileSync(join(dir, 'printer.ext'), 'extendedKeyUsage=serverAuth\n');
    openssl(dir, 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${opts.serial}`, '-keyout', 'printer.key', '-out', 'printer.csr');
    openssl(dir, 'x509', '-req', '-in', 'printer.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
      '-days', DAYS, '-extfile', 'printer.ext', '-out', 'printer.pem');
  }
  const cert = Buffer.concat([readFileSync(join(dir, 'printer.pem')), readFileSync(join(dir, 'ca.pem'))]);
  writeFileSync(join(dir, 'printer-chain.pem'), cert);
  writeFileSync(join(dir, 'passwd'), `${passwordLine(PRINTER_ACCESS.USER, opts.code)}\n`, { mode: 0o644 });
  writeFileSync(join(dir, 'mosquitto.conf'), renderSimBrokerConf(opts.mount));
  return { key: readFileSync(join(dir, 'printer.key')), cert };
}
