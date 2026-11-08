import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { X509Certificate, pbkdf2Sync } from 'crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { passwordLine, prepareSimBroker, renderSimBrokerConf } from '../../../../examples/workflows/bambu-printer/sim/broker';
import { SERIAL } from '../../../fixtures/bambu/reports';

describe('simulated printer broker files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bambu-sim-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a Mosquitto $7$ password line Mosquitto can check', () => {
    const line = passwordLine('bblp', '12345678', Buffer.alloc(12, 1));
    const [user, hashed] = line.split(':');
    const [, kind, iterations, salt, hash] = hashed.split('$');
    expect([user, kind, iterations]).toEqual(['bblp', '7', '101']);
    expect(pbkdf2Sync('12345678', Buffer.from(salt, 'base64'), 101, 64, 'sha512').toString('base64')).toBe(hash);
  });

  it('salts each password line afresh', () => {
    expect(passwordLine('bblp', 'x')).not.toBe(passwordLine('bblp', 'x'));
  });

  it('configures a TLS listener on 8883 that takes bblp and the access code only', () => {
    const conf = renderSimBrokerConf('/sim');
    expect(conf).toContain('allow_anonymous false');
    expect(conf).toContain('password_file /sim/passwd');
    expect(conf).toContain('listener 8883');
    expect(conf).toContain('certfile /sim/printer-chain.pem');
  });

  it('issues the printer certificate to its serial and serves it with the CA', () => {
    const { cert, key } = prepareSimBroker(dir, { serial: SERIAL, code: '12345678', mount: '/sim' });
    const leaf = new X509Certificate(readFileSync(join(dir, 'printer.pem')));
    const ca = new X509Certificate(readFileSync(join(dir, 'ca.pem')));
    expect(leaf.subject).toBe(`CN=${SERIAL}`);
    expect(leaf.verify(ca.publicKey)).toBe(true);
    expect(cert.toString()).toBe(`${readFileSync(join(dir, 'printer.pem'))}${readFileSync(join(dir, 'ca.pem'))}`);
    expect(key.toString()).toContain('PRIVATE KEY');
    expect(readFileSync(join(dir, 'passwd'), 'utf8')).toMatch(/^bblp:\$7\$101\$/);
  });

  it('keeps the certificates on a second run and writes the password again', () => {
    const before = statSync(join(dir, 'printer.pem')).mtimeMs;
    const passwd = readFileSync(join(dir, 'passwd'), 'utf8');
    prepareSimBroker(dir, { serial: SERIAL, code: 'another', mount: '/sim' });
    expect(statSync(join(dir, 'printer.pem')).mtimeMs).toBe(before);
    expect(readFileSync(join(dir, 'passwd'), 'utf8')).not.toBe(passwd);
  });
});
