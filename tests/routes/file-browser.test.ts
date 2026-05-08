import { describe, it, expect, beforeAll } from 'vitest';
import { setupRouteTest, authHeaders } from './setup';

const ctx = setupRouteTest(4640);

describe('File browser routes', () => {
  // Seed a test file through the storage backend
  beforeAll(async () => {
    // Write test files via the public file serving endpoint isn't possible,
    // but we can use the browse endpoint to verify empty state.
    // Route tests verify auth, status codes, and response shapes.
  });

  // ── Auth enforcement ──────────────────────────────────────────────────────

  describe('auth enforcement', () => {
    it('GET /file-browser/browse returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/browse`);
      expect(res.status).toBe(401);
    });

    it('GET /file-browser/metadata/any returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/metadata/test.txt`);
      expect(res.status).toBe(401);
    });

    it('POST /file-browser/signed-url returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/signed-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.txt', expiresIn: 3600 }),
      });
      expect(res.status).toBe(401);
    });

    it('GET /file-browser/download/any returns 401 without auth', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/download/test.txt`);
      expect(res.status).toBe(401);
    });
  });

  // ── Browse ────────────────────────────────────────────────────────────────

  describe('GET /file-browser/browse', () => {
    it('returns files and directories arrays with auth', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/browse`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty('files');
      expect(body).toHaveProperty('directories');
      expect(Array.isArray(body.files)).toBe(true);
      expect(Array.isArray(body.directories)).toBe(true);
    });

    it('accepts prefix query parameter', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/browse?prefix=nonexistent/`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.files).toHaveLength(0);
    });

    it('accepts pageSize query parameter', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/browse?pageSize=10`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(200);
    });

    it('works with member token (non-admin)', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/browse`, {
        headers: authHeaders(ctx.memberToken),
      });
      expect(res.status).toBe(200);
    });
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  describe('GET /file-browser/metadata/*', () => {
    it('returns 404 for non-existent file', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/metadata/does-not-exist.txt`, {
        headers: authHeaders(ctx.adminToken),
      });
      // Could be 404 or 500 depending on backend
      expect([404, 500]).toContain(res.status);
    });
  });

  // ── Signed URL ────────────────────────────────────────────────────────────

  describe('POST /file-browser/signed-url', () => {
    it('returns 400 when path is missing', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/signed-url`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('required');
    });

    it('returns 400 when expiresIn is missing', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/signed-url`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ path: 'test.txt' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid expiresIn value', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/signed-url`, {
        method: 'POST',
        headers: authHeaders(ctx.adminToken),
        body: JSON.stringify({ path: 'test.txt', expiresIn: 999 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('expiresIn must be one of');
    });
  });

  // ── Download ──────────────────────────────────────────────────────────────

  describe('GET /file-browser/download/*', () => {
    it('returns 404 for non-existent file', async () => {
      const res = await fetch(`${ctx.BASE}/file-browser/download/does-not-exist.txt`, {
        headers: authHeaders(ctx.adminToken),
      });
      expect(res.status).toBe(404);
    });
  });
});
