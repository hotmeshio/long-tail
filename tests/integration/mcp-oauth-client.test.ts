/**
 * An MCP client connects over OAuth, end to end, with the MCP SDK's own OAuth
 * client: discovery (RFC 9728, RFC 8414), dynamic registration, PKCE, code
 * exchange and refresh are the SDK's. The test stands in only for the
 * person's click on the consent page, approving through its API.
 *
 * Requires docker compose up with LT_OAUTH_ISSUER=http://localhost:3000.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

import { ApiClient, pgQuery, waitForHealth } from './helpers';

const BASE_URL = process.env.LT_BASE_URL || 'http://localhost:3000';
const MCP_URL = new URL(`${BASE_URL}/mcp`);
const REDIRECT = 'http://127.0.0.1:33418/callback';

class TestProvider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = '';
  authorizationUrl?: URL;
  get redirectUrl() { return REDIRECT; }
  get clientMetadata() {
    return { client_name: 'sdk-e2e', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  state() { return 'sdk-e2e-state'; }
  clientInformation() { return this.info; }
  saveClientInformation(info: OAuthClientInformationMixed) { this.info = info; }
  tokens() { return this.saved; }
  saveTokens(tokens: OAuthTokens) { this.saved = tokens; }
  redirectToAuthorization(url: URL) { this.authorizationUrl = url; }
  saveCodeVerifier(v: string) { this.verifier = v; }
  codeVerifier() { return this.verifier; }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'tokens') this.saved = undefined;
    if (scope === 'all' || scope === 'client') this.info = undefined;
  }
}

let session: string;

/** What the person does in the browser: follow authorize to consent, then approve. */
async function consent(authorizationUrl: URL, preset: 'read_only' | 'just_me'): Promise<string> {
  const res = await fetch(authorizationUrl, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const consentUrl = new URL(res.headers.get('location')!);
  expect(consentUrl.pathname).toBe('/oauth/consent');
  const approve = await fetch(`${BASE_URL}/api/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` },
    body: JSON.stringify({ ...Object.fromEntries(consentUrl.searchParams), preset }),
  });
  const redirect = new URL((await approve.json()).redirect);
  expect(redirect.searchParams.get('state')).toBe('sdk-e2e-state');
  return redirect.searchParams.get('code')!;
}

async function connect(provider: TestProvider): Promise<Client> {
  const client = new Client({ name: 'sdk-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(MCP_URL, { authProvider: provider }));
  return client;
}

/** Sign in from scratch: the SDK is sent to authorize, the person approves, the SDK exchanges the code. */
async function signIn(provider: TestProvider, preset: 'read_only' | 'just_me'): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(MCP_URL, { authProvider: provider });
  await expect(new Client({ name: 'sdk-e2e', version: '1.0.0' }).connect(transport)).rejects.toThrow(UnauthorizedError);
  await transport.finishAuth(await consent(provider.authorizationUrl!, preset));
  return connect(provider);
}

const registered: string[] = [];

beforeAll(async () => {
  await waitForHealth(BASE_URL);
  session = await new ApiClient(BASE_URL).login('superadmin', 'l0ngt@1l');
}, 120_000);

afterAll(async () => {
  if (registered.length) await pgQuery('DELETE FROM lt_oauth_clients WHERE client_id = ANY($1)', [registered]);
});

describe('MCP SDK client over OAuth', () => {
  it('discovers, registers, signs in and lists tools', async () => {
    const provider = new TestProvider();
    const client = await signIn(provider, 'read_only');
    registered.push(provider.info!.client_id);
    expect(provider.saved).toMatchObject({ token_type: 'Bearer', scope: 'mcp:read' });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('find_escalations');
    expect(names).not.toContain('admin_resolve_escalation');
    await client.close();
  });

  it('refreshes on its own when the access token stops working', async () => {
    const provider = new TestProvider();
    (await signIn(provider, 'just_me')).close();
    registered.push(provider.info!.client_id);
    const firstRefresh = provider.saved!.refresh_token;
    provider.saved = { ...provider.saved!, access_token: 'no-longer-valid' };
    const client = await connect(provider);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('admin_resolve_escalation');
    expect(provider.saved!.refresh_token).not.toBe(firstRefresh);
    await client.close();
  });

  it('must sign in again once the person disconnects it', async () => {
    const provider = new TestProvider();
    (await signIn(provider, 'read_only')).close();
    registered.push(provider.info!.client_id);
    const grants = await (await fetch(`${BASE_URL}/api/oauth/grants`, { headers: { authorization: `Bearer ${session}` } })).json();
    const grant = grants.grants.find((g: { client_id: string }) => g.client_id === provider.info!.client_id);
    await fetch(`${BASE_URL}/api/oauth/grants/${grant.grant_id}`, { method: 'DELETE', headers: { authorization: `Bearer ${session}` } });
    provider.authorizationUrl = undefined;
    await expect(connect(provider)).rejects.toThrow(UnauthorizedError);
    expect(provider.authorizationUrl).toBeDefined();
  });
});
