import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startControl } from '../../../../examples/workflows/bambu-printer/sim/control';
import type { StoredFile } from '../../../../examples/workflows/bambu-printer/sim/ftps';
import { SimPrinter } from '../../../../examples/workflows/bambu-printer/sim/printer';

describe('simulated printer drills', () => {
  const printer = new SimPrinter({ report: () => undefined });
  const stored = new Map<string, StoredFile>([['R1.gcode.3mf', { name: 'R1.gcode.3mf', bytes: 3, sha256: 'abc', at: 'now' }]]);
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = await startControl(printer, stored, 0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const post = (path: string, body?: unknown) => fetch(`${base}${path}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

  it('answers the state and the stored files', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: { gcode_state: 'IDLE' }, files: [{ name: 'R1.gcode.3mf' }] });
  });

  it('runs out of filament and resumes', async () => {
    expect((await (await post('/runout')).json()).state).toMatchObject({ gcode_state: 'PAUSE', print_error: 134184977 });
    expect((await (await post('/resume')).json()).state).toMatchObject({ gcode_state: 'RUNNING', print_error: 0 });
  });

  it('occupies and vacates the printer', async () => {
    expect((await (await post('/occupy')).json()).state.subtask_name).toBe('a-print-started-elsewhere');
    expect((await (await post('/vacate')).json()).state.gcode_state).toBe('IDLE');
  });

  it('holds at the percent given, and releases', async () => {
    expect((await post('/hold', { percent: 40 })).status).toBe(200);
    expect((await post('/release')).status).toBe(200);
  });

  it('answers 404 for an unknown drill and 400 for a bad body', async () => {
    expect((await post('/explode')).status).toBe(404);
    const bad = await fetch(`${base}/hold`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
  });
});
