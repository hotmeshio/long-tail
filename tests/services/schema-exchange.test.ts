import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { createServer, type Server } from 'http';

vi.mock('../../services/iam/context', () => ({
  getToolContext: vi.fn(),
}));

vi.mock('../../services/iam/credentials', () => ({
  resolveCredential: vi.fn(),
}));

import { validateSchema, exchange } from '../../system/activities/schema-exchange';
import { getToolContext } from '../../services/iam/context';
import { resolveCredential } from '../../services/iam/credentials';

const mockedGetToolContext = vi.mocked(getToolContext);
const mockedResolveCredential = vi.mocked(resolveCredential);

// Tiny HTTP server for exchange tests
let server: Server;
let baseUrl: string;

beforeEach(() => {
  vi.clearAllMocks();
});

function startServer(handler: (req: any, res: any) => void): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

afterEach(() => {
  if (server) server.close();
});

// ── validateSchema ──────────────────────────────────────────

describe('validateSchema', () => {
  it('returns valid for matching data', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
    const result = validateSchema({ name: 'alice' }, schema);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('returns errors for mismatched data', () => {
    const schema = { type: 'object', properties: { age: { type: 'number' } }, required: ['age'] };
    const result = validateSchema({ age: 'not-a-number' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('age');
  });

  it('normalizes indexed-object required to array (HotMesh YAML fix)', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: { '0': 'a', '1': 'b' } as any,
    };
    const passing = validateSchema({ a: 'x', b: 'y' }, schema);
    expect(passing.valid).toBe(true);

    const failing = validateSchema({}, schema);
    expect(failing.valid).toBe(false);
    expect(failing.errors.some((e) => e.includes('a') || e.includes('b'))).toBe(true);
  });
});

// ── exchange ────────────────────────────────────────────────

describe('exchange', () => {
  it('returns validated: true when response matches response_schema', async () => {
    baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 1 }));
    });
    const result = await exchange({
      url: baseUrl,
      method: 'GET',
      response_schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    });
    expect(result.status).toBe(200);
    expect(result.validated).toBe(true);
    expect(result.validation_errors).toEqual([]);
  });

  it('returns validated: false when response mismatches response_schema', async () => {
    baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'not-a-number' }));
    });
    const result = await exchange({
      endpoint: baseUrl,
      method: 'GET',
      response_schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    });
    expect(result.validated).toBe(false);
    expect(result.validation_errors.length).toBeGreaterThan(0);
    expect(result.validation_errors[0]).toMatch(/^response:/);
  });

  it('returns status 0 and never sends when request_schema fails', async () => {
    let called = false;
    baseUrl = await startServer((_req, res) => {
      called = true;
      res.end();
    });
    const result = await exchange({
      url: baseUrl,
      method: 'POST',
      body: { count: 'bad' },
      request_schema: { type: 'object', properties: { count: { type: 'number' } } },
    });
    expect(result.status).toBe(0);
    expect(result.validated).toBe(false);
    expect(result.validation_errors[0]).toMatch(/^request:/);
    expect(called).toBe(false);
  });

  it('returns clear error for 401', async () => {
    baseUrl = await startServer((_req, res) => { res.writeHead(401); res.end(); });
    const result = await exchange({ url: baseUrl, method: 'GET' });
    expect(result.status).toBe(401);
    expect(result.validation_errors[0]).toContain('authentication');
  });

  it('returns clear error for 403', async () => {
    baseUrl = await startServer((_req, res) => { res.writeHead(403); res.end(); });
    const result = await exchange({ url: baseUrl, method: 'GET' });
    expect(result.status).toBe(403);
    expect(result.validation_errors[0]).toContain('authorization');
  });

  it('accepts url as alias for endpoint', async () => {
    baseUrl = await startServer((_req, res) => { res.writeHead(200); res.end('ok'); });
    const result = await exchange({ url: baseUrl, method: 'GET' });
    expect(result.status).toBe(200);
  });

  it('returns error when neither url nor endpoint provided', async () => {
    const result = await exchange({ method: 'GET' });
    expect(result.status).toBe(0);
    expect(result.validation_errors[0]).toContain('endpoint or url');
  });

  it('returns error when credential_provider set but no ToolContext', async () => {
    mockedGetToolContext.mockReturnValue(null as any);
    const result = await exchange({ url: 'http://example.com', method: 'GET', credential_provider: 'github' });
    expect(result.status).toBe(0);
    expect(result.validation_errors[0]).toContain('identity context');
  });

  it('formats Basic auth_scheme correctly', async () => {
    mockedGetToolContext.mockReturnValue({ principal: { id: 'u1' } } as any);
    mockedResolveCredential.mockResolvedValue({ value: 'dXNlcjpwYXNz' } as any);

    let capturedAuth: string | null = null;
    baseUrl = await startServer((req, res) => {
      capturedAuth = req.headers['authorization'] ?? null;
      res.writeHead(200);
      res.end('ok');
    });
    await exchange({ url: baseUrl, method: 'GET', credential_provider: 'svc', auth_scheme: 'Basic' });
    expect(capturedAuth).toBe('Basic dXNlcjpwYXNz');
  });

  it('uses custom auth_header name', async () => {
    mockedGetToolContext.mockReturnValue({ principal: { id: 'u1' } } as any);
    mockedResolveCredential.mockResolvedValue({ value: 'key123' } as any);

    let capturedHeader: string | null = null;
    baseUrl = await startServer((req, res) => {
      capturedHeader = req.headers['x-api-key'] ?? null;
      res.writeHead(200);
      res.end('ok');
    });
    await exchange({ url: baseUrl, method: 'GET', credential_provider: 'svc', auth_header: 'X-API-Key' });
    expect(capturedHeader).toBe('Bearer key123');
  });
});
