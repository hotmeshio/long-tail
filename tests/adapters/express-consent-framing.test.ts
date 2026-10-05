import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';

import { LTExpressAdapter } from '../../adapters/express';
import { createApp } from '../../lib/http';

// The consent page is never framed, and a host's own security policy is kept
// alongside the consent page's.
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

  it('keeps a host policy and adds its own, so a host frame-ancestors cannot allow framing', async () => {
    const res = await fetch(`${await listen("default-src 'self'; frame-ancestors 'self'")}/oauth/consent`);
    // Two CSP headers arrive joined; browsers enforce both, so 'none' wins.
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'; frame-ancestors 'self', frame-ancestors 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('other dashboard pages are unchanged', async () => {
    const res = await fetch(`${await listen()}/escalations`);
    expect(res.headers.get('x-frame-options')).toBeNull();
  });
});
