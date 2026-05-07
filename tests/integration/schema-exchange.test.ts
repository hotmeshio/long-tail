/**
 * Schema Exchange — Self-Reflective Integration Test
 *
 * Long Tail wraps its own API using the schema-exchange tool.
 * The platform validates its own endpoint responses against formalized
 * schemas, proving the same machinery that wraps Epic, Stripe, or any
 * external API works end-to-end.
 *
 * See docs/self-test.md for the full narrative.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { waitForHealth, ApiClient, log } from './helpers';

const BASE_URL = process.env.LT_BASE_URL || 'http://localhost:3000';

// ── Schemas that formalize Long Tail's own API ─────────────────────────────

const LOGIN_REQUEST_SCHEMA = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string' },
    password: { type: 'string' },
  },
};

const LOGIN_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['token', 'user'],
  properties: {
    token: { type: 'string' },
    user: {
      type: 'object',
      required: ['id', 'external_id', 'display_name', 'roles'],
      properties: {
        id: { type: 'string' },
        external_id: { type: 'string' },
        display_name: { type: 'string' },
        roles: {
          type: 'array',
          items: {
            type: 'object',
            required: ['role', 'type'],
            properties: {
              role: { type: 'string' },
              type: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const SERVERS_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['servers'],
  properties: {
    servers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          status: { type: 'string' },
        },
      },
    },
  },
};

const WORKFLOWS_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['workflows', 'total'],
  properties: {
    workflows: { type: 'array' },
    total: { type: 'number' },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

let api: ApiClient;
let token: string;
let schemaExchangeServerId: string;

async function callExchange(args: Record<string, unknown>): Promise<any> {
  const { data } = await api.post(
    `/api/mcp/servers/${schemaExchangeServerId}/tools/exchange/call`,
    { arguments: args },
  );
  return (data as any).result || data;
}

async function callValidate(data: unknown, schema: Record<string, unknown>): Promise<any> {
  const { data: resp } = await api.post(
    `/api/mcp/servers/${schemaExchangeServerId}/tools/validate_schema/call`,
    { arguments: { data, schema } },
  );
  return (resp as any).result || resp;
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await waitForHealth(BASE_URL);
  api = new ApiClient(BASE_URL);
  token = await api.login('superadmin', 'l0ngt@1l');
  log('setup', 'authenticated');

  // Find the schema-exchange server ID
  const { data: serverData } = await api.get('/api/mcp/servers');
  const servers = (serverData as any).servers || serverData;
  const server = servers.find((s: any) => s.name === 'long-tail-schema-exchange');
  expect(server).toBeDefined();
  schemaExchangeServerId = server.id;
  log('setup', `schema-exchange server: ${schemaExchangeServerId}`);
}, 120_000);

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Schema Exchange — self-reflective API test', () => {
  it('authenticates against its own login endpoint with schema validation', async () => {
    const result = await callExchange({
      endpoint: `${BASE_URL}/api/auth/login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'superadmin', password: 'l0ngt@1l' },
      request_schema: LOGIN_REQUEST_SCHEMA,
      response_schema: LOGIN_RESPONSE_SCHEMA,
    });

    log('login', `status=${result.status} validated=${result.validated} elapsed=${result.elapsed_ms}ms`);

    expect(result.status).toBe(200);
    expect(result.validated).toBe(true);
    expect(result.validation_errors).toEqual([]);
    expect(result.data.token).toBeDefined();
    expect(result.data.user.display_name).toBe('Super Admin');
  });

  it('lists MCP servers and validates the schema-exchange server exists', async () => {
    const result = await callExchange({
      endpoint: `${BASE_URL}/api/mcp/servers`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      response_schema: SERVERS_RESPONSE_SCHEMA,
    });

    log('servers', `status=${result.status} validated=${result.validated} count=${result.data.servers.length}`);

    expect(result.status).toBe(200);
    expect(result.validated).toBe(true);

    // The tool that's asking the question can find itself in the response
    const self = result.data.servers.find((s: any) => s.name === 'long-tail-schema-exchange');
    expect(self).toBeDefined();
    expect(self.tags).toContain('schema');
    log('servers', 'schema-exchange server found itself in the response');
  });

  it('lists compiled workflows and validates the response shape', async () => {
    const result = await callExchange({
      endpoint: `${BASE_URL}/api/yaml-workflows`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      response_schema: WORKFLOWS_RESPONSE_SCHEMA,
    });

    log('workflows', `status=${result.status} validated=${result.validated} total=${result.data.total}`);

    expect(result.status).toBe(200);
    expect(result.validated).toBe(true);
    expect(typeof result.data.total).toBe('number');
  });

  it('detects schema drift when the response shape changes', async () => {
    // Deliberately wrong schema — expects fields that don't exist
    const wrongSchema = {
      type: 'object',
      required: ['access_token', 'refresh_token', 'expires_in'],
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        expires_in: { type: 'number' },
      },
    };

    const result = await callExchange({
      endpoint: `${BASE_URL}/api/auth/login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'superadmin', password: 'l0ngt@1l' },
      response_schema: wrongSchema,
    });

    log('drift', `validated=${result.validated} errors=${result.validation_errors.length}`);

    expect(result.status).toBe(200); // HTTP succeeded
    expect(result.validated).toBe(false); // Schema did not match
    expect(result.validation_errors.length).toBeGreaterThan(0);
    expect(result.validation_errors.some((e: string) => e.includes('access_token'))).toBe(true);
    log('drift', 'correctly detected missing access_token — schema drift caught');
  });

  it('rejects malformed requests before they leave the system', async () => {
    const result = await callExchange({
      endpoint: `${BASE_URL}/api/auth/login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 12345 }, // wrong type, missing password
      request_schema: LOGIN_REQUEST_SCHEMA,
    });

    log('reject', `status=${result.status} validated=${result.validated}`);

    expect(result.status).toBe(0); // Never sent
    expect(result.validated).toBe(false);
    expect(result.validation_errors.some((e: string) => e.includes('password'))).toBe(true);
    expect(result.validation_errors.some((e: string) => e.includes('must be string'))).toBe(true);
    log('reject', 'bad request stopped at the gate — never hit the network');
  });

  it('validates arbitrary data with validate_schema (no network call)', async () => {
    const good = await callValidate(
      { name: 'Long Tail', version: 1 },
      { type: 'object', required: ['name', 'version'], properties: { name: { type: 'string' }, version: { type: 'number' } } },
    );
    expect(good.valid).toBe(true);
    expect(good.errors).toEqual([]);

    const bad = await callValidate(
      { name: 123 },
      { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    );
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
    log('validate', `good=${good.valid} bad=${bad.valid} — standalone validation works`);
  });
});
