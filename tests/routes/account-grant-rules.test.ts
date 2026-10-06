import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { setupRouteTest, authHeaders } from './setup';
import { signToken } from '../../modules/auth';
import * as userService from '../../services/user';

// A builder may manage accounts, but never into or over the superadmin tier.
const ctx = setupRouteTest(4639);
const STAMP = Date.now();
let engineerToken: string;
let engineerId: string;
let superTargetId: string;
const created: string[] = [];

const send = (method: string, path: string, token: string, body?: unknown) =>
  fetch(`${ctx.BASE}${path}`, { method, headers: authHeaders(token), ...(body ? { body: JSON.stringify(body) } : {}) });

beforeAll(async () => {
  engineerId = (await userService.createUser({ external_id: `grant-engineer-${STAMP}`, roles: [{ role: 'engineer', type: 'member' } as any] })).id;
  superTargetId = (await userService.createUser({ external_id: `grant-super-${STAMP}`, roles: [{ role: 'superadmin', type: 'superadmin' } as any] })).id;
  created.push(engineerId, superTargetId);
  engineerToken = signToken({ userId: engineerId, role: 'member' });
}, 30_000);

afterAll(async () => {
  for (const id of created) await userService.deleteUser(id).catch(() => undefined);
});

describe('user accounts', () => {
  it('a builder may not create a superadmin user', async () => {
    const res = await send('POST', '/users', engineerToken, { external_id: `x-${STAMP}`, roles: [{ role: 'superadmin', type: 'superadmin' }] });
    expect(res.status).toBe(403);
  });

  it('a builder may create a member user', async () => {
    const res = await send('POST', '/users', engineerToken, { external_id: `member-${STAMP}`, roles: [{ role: 'reviewer', type: 'member' }] });
    expect(res.status).toBe(201);
    created.push((await res.json()).id);
  });

  it('a builder may not update, patch or delete a superadmin, or strip its superadmin grant', async () => {
    expect((await send('PUT', `/users/${superTargetId}`, engineerToken, { display_name: 'x' })).status).toBe(403);
    expect((await send('PATCH', `/users/${superTargetId}/properties`, engineerToken, { set: { a: 1 } })).status).toBe(403);
    expect((await send('DELETE', `/users/${superTargetId}/roles/superadmin`, engineerToken)).status).toBe(403);
    expect((await send('DELETE', `/users/${superTargetId}`, engineerToken)).status).toBe(403);
    expect(await userService.getUser(superTargetId)).not.toBeNull();
  });

  it('a superadmin may update a superadmin', async () => {
    expect((await send('PUT', `/users/${superTargetId}`, ctx.builderToken, { display_name: 'kept' })).status).toBe(200);
  });
});

describe('bot accounts', () => {
  let superBot: string;

  it('a builder may not create a superadmin bot', async () => {
    const res = await send('POST', '/bot-accounts', engineerToken, { name: `sb-${STAMP}`, roles: [{ role: 'superadmin', type: 'superadmin' }] });
    expect(res.status).toBe(403);
  });

  it('a builder may not mint a key for a superadmin bot; a superadmin may', async () => {
    const res = await send('POST', '/bot-accounts', ctx.builderToken, { name: `sb2-${STAMP}`, roles: [{ role: 'superadmin', type: 'superadmin' }] });
    expect(res.status).toBe(201);
    superBot = (await res.json()).id;
    created.push(superBot);
    expect((await send('POST', `/bot-accounts/${superBot}/api-keys`, engineerToken, { name: 'k' })).status).toBe(403);
    expect((await send('POST', `/bot-accounts/${superBot}/api-keys`, ctx.builderToken, { name: 'k' })).status).toBe(201);
  });

  it('a key is revoked only through its own bot', async () => {
    const keys = await (await send('GET', `/bot-accounts/${superBot}/api-keys`, ctx.builderToken)).json();
    const keyId = keys.keys[0].id;
    const member = await send('POST', '/bot-accounts', ctx.builderToken, { name: `mb-${STAMP}`, roles: [{ role: 'reviewer', type: 'member' }] });
    const memberBot = (await member.json()).id;
    created.push(memberBot);
    expect((await send('DELETE', `/bot-accounts/${memberBot}/api-keys/${keyId}`, engineerToken)).status).toBe(404);
    expect((await send('DELETE', `/bot-accounts/${superBot}/api-keys/${keyId}`, engineerToken)).status).toBe(403);
    expect((await send('DELETE', `/bot-accounts/${superBot}/api-keys/${keyId}`, ctx.builderToken)).status).toBe(200);
  });
});
