import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { connect } from 'tls';
import type { Server } from 'tls';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prepareSimBroker } from '../../../../examples/workflows/bambu-printer/sim/broker';
import { startFtps, type StoredFile } from '../../../../examples/workflows/bambu-printer/sim/ftps';
import { stageFile } from '../../../../examples/workflows/bambu-printer/files';
import { SERIAL } from '../../../fixtures/bambu/reports';

// The client dials the printer's FTPS port; tests serve it on one that needs no privilege.
const { PORT } = vi.hoisted(() => ({ PORT: 19990 }));
vi.mock('../../../../examples/workflows/bambu-printer/env', async (load) => {
  const env = await load<typeof import('../../../../examples/workflows/bambu-printer/env')>();
  return { ...env, PRINTER_ACCESS: { ...env.PRINTER_ACCESS, FTPS_PORT: PORT } };
});

/** Send raw commands on a control session; resolves with every line the server sent. */
function converse(commands: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const socket = connect({ host: '127.0.0.1', port: PORT, rejectUnauthorized: false }, () => {
      for (const c of commands) socket.write(`${c}\r\n`);
      setTimeout(() => socket.end(), 200);
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => lines.push(...chunk.split('\r\n').filter(Boolean)));
    socket.on('end', () => resolve(lines));
    socket.on('error', reject);
  });
}

describe('simulated printer storage (FTPS)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bambu-ftps-'));
  const stored = new Map<string, StoredFile>();
  let server: Server;

  beforeAll(async () => {
    const tls = prepareSimBroker(dir, { serial: SERIAL, code: 'sim-code', mount: '/sim' });
    server = await startFtps({ ...tls, code: 'sim-code', port: PORT }, stored);
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('takes a file from the example FTPS client and returns the URL a print names', async () => {
    const file = join(dir, 'part.gcode.3mf');
    const bytes = Buffer.alloc(300_000, 7);
    writeFileSync(file, bytes);
    const url = await stageFile({ host: '127.0.0.1', code: 'sim-code' }, file, 'R1.gcode.3mf');
    expect(url).toBe('file:///sdcard/cache/R1.gcode.3mf');
    expect(stored.get('R1.gcode.3mf')).toMatchObject({ bytes: 300_000, sha256: createHash('sha256').update(bytes).digest('hex') });
  });

  it('refuses a wrong access code', async () => {
    const file = join(dir, 'other.gcode.3mf');
    writeFileSync(file, 'x');
    await expect(stageFile({ host: '127.0.0.1', code: 'wrong' }, file, 'R2.gcode.3mf')).rejects.toThrow(/530/);
  });

  it('answers commands before login with 530', async () => {
    const lines = await converse(['PASV']);
    expect(lines).toEqual(['220 Simulated printer FTPS ready', '530 Not logged in']);
  });

  it('asks for PASV before STOR, and names commands it does not serve', async () => {
    const lines = await converse(['USER bblp', 'PASS sim-code', 'STOR cache/x', 'LIST']);
    expect(lines.slice(1)).toEqual(['331 Password required', '230 Logged in', '425 Use PASV first', '502 LIST not implemented']);
  });
});
