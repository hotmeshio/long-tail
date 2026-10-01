import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';

import { LTExpressAdapter } from '../../adapters/express';
import { createApp } from '../../lib/http';

// The consent page is never framed by another site, and a host's own
// security policy is kept.
const DASHBOARD_BUILT = existsSync(path.resolve(__dirname, '..', '..', 'dashboard', 'dist', 'index.html'));
let server: Server | null = null;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

async function listen(hostPolicy?: string): Promise<string> {
  const host = createApp();
  if (hostPolicy) host.use((_req, res, next) => { res.setHeader('Content-Security-Policy', hostPolicy); next(); });
  host.use(new LTExpressAdapter().getRouter());
  server = host.listen(0);
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe.skipIf(!DASHBOARD_BUILT)('consent page framing', () => {
  it('forbids framing when the host sets no policy', async () => {
    const res = await fetch(`${await listen()}/oauth/consent?client_id=x`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });

  it('keeps a host policy and still forbids framing', async () => {
    const res = await fetch(`${await listen("default-src 'self'")}/oauth/consent`);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('other dashboard pages are unchanged', async () => {
    const res = await fetch(`${await listen()}/escalations`);
    expect(res.headers.get('x-frame-options')).toBeNull();
  });
});
