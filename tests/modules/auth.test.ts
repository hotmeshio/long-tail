import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

import { config } from '../../modules/config';
import {
  JwtAuthAdapter,
  createAuthMiddleware,
  requireAuth,
  requireAdmin,
  signToken,
} from '../../modules/auth';
import type { AuthPayload, LTAuthAdapter } from '../../types';

function mockReqRes(authHeader?: string) {
  const req = {
    headers: { authorization: authHeader },
    auth: undefined,
  } as any;
  const res = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; },
  } as any;
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, wasNextCalled: () => nextCalled };
}

const TEST_SECRET = 'test-secret-key';

describe('Pluggable auth system', () => {
  beforeAll(() => {
    (config as any).JWT_SECRET = TEST_SECRET;
  });

  // ── JwtAuthAdapter ──────────────────────────────────────────────────────

  describe('JwtAuthAdapter', () => {
    it('should return payload for valid Bearer token', () => {
      const adapter = new JwtAuthAdapter(TEST_SECRET);
      const token = jwt.sign({ userId: 'user-1', role: 'admin' }, TEST_SECRET);
      const { req } = mockReqRes(`Bearer ${token}`);
      const result = adapter.authenticate(req);
      expect(result).toBeTruthy();
      expect(result!.userId).toBe('user-1');
      expect(result!.role).toBe('admin');
    });

    it('should return null for missing Authorization header', () => {
      const adapter = new JwtAuthAdapter(TEST_SECRET);
      const { req } = mockReqRes();
      expect(adapter.authenticate(req)).toBeNull();
    });

    it('should return null for non-Bearer scheme', () => {
      const adapter = new JwtAuthAdapter(TEST_SECRET);
      const { req } = mockReqRes('Basic abc123');
      expect(adapter.authenticate(req)).toBeNull();
    });

    it('should return null for invalid token', () => {
      const adapter = new JwtAuthAdapter(TEST_SECRET);
      const { req } = mockReqRes('Bearer invalid-garbage');
      expect(adapter.authenticate(req)).toBeNull();
    });

    it('should return null for expired token', () => {
      const adapter = new JwtAuthAdapter(TEST_SECRET);
      const token = jwt.sign({ userId: 'user-1' }, TEST_SECRET, { expiresIn: '0s' });
      const { req } = mockReqRes(`Bearer ${token}`);
      expect(adapter.authenticate(req)).toBeNull();
    });

    it('should return null when secret is empty', () => {
      const adapter = new JwtAuthAdapter('');
      const token = jwt.sign({ userId: 'user-1' }, TEST_SECRET);
      const { req } = mockReqRes(`Bearer ${token}`);
      expect(adapter.authenticate(req)).toBeNull();
    });
  });

  // ── createAuthMiddleware ────────────────────────────────────────────────

  describe('createAuthMiddleware', () => {
    it('should call next and set req.auth for valid adapter response', async () => {
      const mockAdapter: LTAuthAdapter = {
        authenticate: () => ({ userId: 'user-42', role: 'reviewer' }),
      };
      const middleware = createAuthMiddleware(mockAdapter);
      const { req, res, next, wasNextCalled } = mockReqRes();
      await middleware(req, res, next);
      expect(wasNextCalled()).toBe(true);
      expect(req.auth.userId).toBe('user-42');
      expect(req.auth.role).toBe('reviewer');
    });

    it('should return 401 when adapter returns null', async () => {
      const mockAdapter: LTAuthAdapter = {
        authenticate: () => null,
      };
      const middleware = createAuthMiddleware(mockAdapter);
      const { req, res, next, wasNextCalled } = mockReqRes();
      await middleware(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
      expect(wasNextCalled()).toBe(false);
    });

    it('should return 401 when adapter payload is missing userId', async () => {
      const mockAdapter: LTAuthAdapter = {
        authenticate: () => ({ role: 'admin' } as any),
      };
      const middleware = createAuthMiddleware(mockAdapter);
      const { req, res, next, wasNextCalled } = mockReqRes();
      await middleware(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toContain('userId');
      expect(wasNextCalled()).toBe(false);
    });

    it('should support async adapters', async () => {
      const asyncAdapter: LTAuthAdapter = {
        authenticate: async () => ({ userId: 'async-user', role: 'reviewer' }),
      };
      const middleware = createAuthMiddleware(asyncAdapter);
      const { req, res, next, wasNextCalled } = mockReqRes();
      await middleware(req, res, next);
      expect(wasNextCalled()).toBe(true);
      expect(req.auth.userId).toBe('async-user');
    });

    it('should return 401 when adapter throws', async () => {
      const throwingAdapter: LTAuthAdapter = {
        authenticate: () => { throw new Error('auth failed'); },
      };
      const middleware = createAuthMiddleware(throwingAdapter);
      const { req, res, next, wasNextCalled } = mockReqRes();
      await middleware(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(wasNextCalled()).toBe(false);
    });
  });

  // ── Custom adapter (pluggability proof) ─────────────────────────────────

  describe('custom adapter', () => {
    it('should work with a non-JWT adapter', async () => {
      // Simulate a simple API key adapter
      class ApiKeyAdapter implements LTAuthAdapter {
        authenticate(req: any): AuthPayload | null {
          const key = req.headers['x-api-key'];
          if (key === 'valid-key') {
            return { userId: 'api-user', role: 'service' };
          }
          return null;
        }
      }

      const middleware = createAuthMiddleware(new ApiKeyAdapter());

      // Valid key
      const validReq = { headers: { 'x-api-key': 'valid-key' }, auth: undefined } as any;
      const validRes = { statusCode: 200, body: undefined as any, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; } } as any;
      let nextCalled = false;
      await middleware(validReq, validRes, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(validReq.auth.userId).toBe('api-user');

      // Invalid key
      const invalidReq = { headers: { 'x-api-key': 'wrong' }, auth: undefined } as any;
      const invalidRes = { statusCode: 200, body: undefined as any, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; } } as any;
      nextCalled = false;
      await middleware(invalidReq, invalidRes, () => { nextCalled = true; });
      expect(nextCalled).toBe(false);
      expect(invalidRes.statusCode).toBe(401);
    });
  });

  // ── requireAuth (convenience export) ────────────────────────────────────

  describe('requireAuth (default JWT middleware)', () => {
    it('should reject requests without Authorization header', async () => {
      const { req, res, next, wasNextCalled } = mockReqRes();
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(wasNextCalled()).toBe(false);
    });

    it('should accept valid JWT tokens', async () => {
      const token = signToken({ userId: 'user-1', role: 'reviewer' });
      const { req, res, next, wasNextCalled } = mockReqRes(`Bearer ${token}`);
      await requireAuth(req, res, next);
      expect(wasNextCalled()).toBe(true);
      expect(req.auth.userId).toBe('user-1');
      expect(req.auth.role).toBe('reviewer');
    });

    it('should reject invalid tokens', async () => {
      const { req, res, next, wasNextCalled } = mockReqRes('Bearer invalid');
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(wasNextCalled()).toBe(false);
    });
  });

  // ── requireAdmin ─────────────────────────────────────────────────────

  describe('requireAdmin (JWT role fallback)', () => {
    it('should allow role=admin via JWT claim', async () => {
      const token = signToken({ userId: 'admin-user', role: 'admin' });
      const { req, res, next, wasNextCalled } = mockReqRes(`Bearer ${token}`);
      // First pass through requireAuth to set req.auth
      await requireAuth(req, res, next);
      expect(wasNextCalled()).toBe(true);

      // Now test requireAdmin
      let adminNextCalled = false;
      await requireAdmin(req, res, () => { adminNextCalled = true; });
      expect(adminNextCalled).toBe(true);
    });

    it('should allow role=superadmin via JWT claim', async () => {
      const token = signToken({ userId: 'sa-user', role: 'superadmin' });
      const { req, res, next, wasNextCalled } = mockReqRes(`Bearer ${token}`);
      await requireAuth(req, res, next);
      expect(wasNextCalled()).toBe(true);

      let adminNextCalled = false;
      await requireAdmin(req, res, () => { adminNextCalled = true; });
      expect(adminNextCalled).toBe(true);
    });

    it('should reject role=reviewer via JWT claim', async () => {
      const token = signToken({ userId: 'rev-user', role: 'reviewer' });
      const { req, res, next, wasNextCalled } = mockReqRes(`Bearer ${token}`);
      await requireAuth(req, res, next);
      expect(wasNextCalled()).toBe(true);

      let adminNextCalled = false;
      await requireAdmin(req, res, () => { adminNextCalled = true; });
      expect(adminNextCalled).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  // ── signToken ──────────────────────────────────────────────────────────

  describe('signToken', () => {
    it('should produce a valid JWT that decodes correctly', () => {
      const token = signToken({ userId: 'sign-test', role: 'admin' });
      const decoded = jwt.verify(token, TEST_SECRET) as AuthPayload;
      expect(decoded.userId).toBe('sign-test');
      expect(decoded.role).toBe('admin');
    });

    it('should respect custom expiry', () => {
      const token = signToken({ userId: 'exp-test' }, '1h');
      const decoded = jwt.decode(token) as any;
      expect(decoded.exp - decoded.iat).toBe(3600);
    });
  });
});
