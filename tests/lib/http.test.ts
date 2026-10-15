import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import path from 'path';

import { Router, createApp, jsonBody, serveStatic } from '../../lib/http';
import type { Application, Request, Response } from '../../lib/http';

let server: Server | null = null;
let tempDir: string | null = null;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  server = null;
  tempDir = null;
});

async function listen(app: Application): Promise<string> {
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('lib/http', () => {
  it('routes requests through a Router mounted on an app from createApp', async () => {
    const router = Router();
    router.get('/ping', (_req: Request, res: Response) => { res.json({ pong: true }); });
    const app = createApp();
    app.use('/api', router);

    const res = await fetch(`${await listen(app)}/api/ping`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
  });

  it('parses JSON bodies with jsonBody', async () => {
    const app = createApp();
    app.use(jsonBody());
    app.post('/echo', (req: Request, res: Response) => { res.json(req.body); });

    const res = await fetch(`${await listen(app)}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });

    expect(await res.json()).toEqual({ a: 1 });
  });

  it('leaves a body the host already parsed unchanged', async () => {
    const app = createApp();
    app.use(jsonBody());
    const guest = Router();
    guest.use(jsonBody());
    guest.post('/echo', (req: Request, res: Response) => { res.json(req.body); });
    app.use('/guest', guest);

    const res = await fetch(`${await listen(app)}/guest/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parsedOnce: true }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ parsedOnce: true });
  });

  it('serves files with serveStatic and passes unknown paths on', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lt-http-'));
    writeFileSync(path.join(tempDir, 'hello.txt'), 'hi');
    const app = createApp();
    app.use(serveStatic(tempDir, { index: false }));
    app.use((_req: Request, res: Response) => { res.status(404).json({ error: 'not found' }); });
    const base = await listen(app);

    const found = await fetch(`${base}/hello.txt`);
    const missing = await fetch(`${base}/nope.txt`);

    expect(await found.text()).toBe('hi');
    expect(missing.status).toBe(404);
  });
});
