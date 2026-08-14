import { describe, it, expect, afterAll } from 'vitest';

import { setupRouteTest, authHeaders } from './setup';
import { getPool } from '../../lib/db';

const ctx = setupRouteTest(4645);

// /api/announcements — publishing is a role-manager act; reading is any
// authenticated user, server-filtered to their roles.

const MARK = `route-ann-${Date.now()}`;

describe('announcements routes', () => {
  afterAll(async () => {
    await getPool().query('DELETE FROM lt_announcements WHERE body LIKE $1', [`${MARK}%`]);
  });

  it('requires authentication to read', async () => {
    const res = await fetch(`${ctx.BASE}/announcements`);
    expect(res.status).toBe(401);
  });

  it('a member cannot publish or delete', async () => {
    const post = await fetch(`${ctx.BASE}/announcements`, {
      method: 'POST',
      headers: authHeaders(ctx.memberToken),
      body: JSON.stringify({ body: `${MARK} nope` }),
    });
    expect(post.status).toBe(403);

    const del = await fetch(`${ctx.BASE}/announcements/00000000-0000-0000-0000-000000000009`, {
      method: 'DELETE',
      headers: authHeaders(ctx.memberToken),
    });
    expect(del.status).toBe(403);
  });

  it('publishes with liberal defaults and serves the role-filtered read', async () => {
    const post = await fetch(`${ctx.BASE}/announcements`, {
      method: 'POST',
      headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ body: `${MARK} system offline at 22:00` }),
    });
    expect(post.status).toBe(200);
    const created = await post.json();
    expect(created.layout).toBe('banner');
    expect(created.roles).toEqual([]);

    // An untargeted notice reaches a plain member.
    const list = await fetch(`${ctx.BASE}/announcements`, { headers: authHeaders(ctx.memberToken) });
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.announcements.some((a: any) => a.id === created.id)).toBe(true);
  });

  it('an empty body is a 400', async () => {
    const res = await fetch(`${ctx.BASE}/announcements`, {
      method: 'POST',
      headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ title: 'no body' }),
    });
    expect(res.status).toBe(400);
  });

  it('a role manager deletes; the row is gone from reads', async () => {
    const post = await fetch(`${ctx.BASE}/announcements`, {
      method: 'POST',
      headers: authHeaders(ctx.builderToken),
      body: JSON.stringify({ body: `${MARK} short lived` }),
    });
    const created = await post.json();

    const del = await fetch(`${ctx.BASE}/announcements/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(ctx.builderToken),
    });
    expect(del.status).toBe(200);

    const list = await fetch(`${ctx.BASE}/announcements`, { headers: authHeaders(ctx.builderToken) });
    const body = await list.json();
    expect(body.announcements.some((a: any) => a.id === created.id)).toBe(false);
  });
});
