import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

import { testConnection } from '../../../services/mcp/client/connection-test';
import { createNetworkTransport } from '../../../services/mcp/client/network-transport';

// Configured headers ride every request a network transport makes, so a
// server that authenticates its callers (another Long Tail's /mcp) is reachable.
let server: http.Server;
let url: string;
const seen: Array<{ method?: string; authorization?: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, authorization: req.headers.authorization });
    res.statusCode = 401;
    res.end('{"error":"Unauthorized"}');
  });
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

describe('network MCP transports', () => {
  it('streamable-http sends the configured headers', async () => {
    seen.length = 0;
    await testConnection('streamable-http', { url, headers: { Authorization: 'Bearer lt-key-1' } });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.authorization === 'Bearer lt-key-1')).toBe(true);
  });

  it('sse sends the configured headers on the stream', async () => {
    seen.length = 0;
    await testConnection('sse', { url, headers: { Authorization: 'Bearer lt-key-2' } });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.authorization === 'Bearer lt-key-2')).toBe(true);
  });

  it('without headers sends none, and a missing url is refused', async () => {
    seen.length = 0;
    await testConnection('streamable-http', { url });
    expect(seen.every((r) => r.authorization === undefined)).toBe(true);
    expect(() => createNetworkTransport('sse', {})).toThrow('needs a url');
  });
});
