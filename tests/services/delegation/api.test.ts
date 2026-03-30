import { describe, it, expect, beforeAll } from 'vitest';
import * as crypto from 'crypto';

import { config } from '../../../modules/config';
import { signToken } from '../../../modules/auth';
import {
  createDelegationToken,
  validateDelegationToken,
  requireScope,
} from '../../../services/auth/delegation';

const TEST_SECRET = 'delegation-api-test-secret';

/**
 * Tests the delegation API logic — the code path used by
 * routes/delegation.ts without requiring a running HTTP server.
 */
describe('Delegation API logic', () => {
  beforeAll(() => {
    (config as any).JWT_SECRET = TEST_SECRET;
  });

  describe('GET /delegation/oauth/:provider/token flow', () => {
    it('should validate delegation token and check provider scope', () => {
      // Simulate: external MCP server calls delegation API with a delegation token
      const delegationJwt = createDelegationToken('user-100', ['oauth:google:read'], 300);

      // Route validates the token
      const payload = validateDelegationToken(delegationJwt);
      expect(payload.sub).toBe('user-100');

      // Route checks scope for the requested provider
      requireScope(payload, 'oauth:google:read');
      // If we get here, scope check passed — route would return the OAuth token
    });

    it('should reject delegation token missing provider scope', () => {
      const delegationJwt = createDelegationToken('user-101', ['files:read'], 300);
      const payload = validateDelegationToken(delegationJwt);

      // User wants Google token but delegation only grants files:read
      expect(() => requireScope(payload, 'oauth:google:read')).toThrow('missing required scope');
    });

    it('should reject non-delegation JWT (e.g., user session token)', () => {
      // A regular user JWT should not be accepted as a delegation token
      // (rejected by issuer mismatch or missing type — either way, blocked)
      const userJwt = signToken({ userId: 'user-102', role: 'admin' });
      expect(() => validateDelegationToken(userJwt)).toThrow();
    });

    it('should reject expired delegation token', async () => {
      const expired = createDelegationToken('user-103', ['oauth:google:read'], 0);
      await new Promise((r) => setTimeout(r, 1100));
      expect(() => validateDelegationToken(expired)).toThrow();
    });
  });

  describe('POST /delegation/validate flow', () => {
    it('should return claims for a valid delegation token', () => {
      const token = createDelegationToken('user-200', ['mcp:tool:call', 'oauth:github:read'], 300, {
        workflowId: 'wf-abc',
        serverId: 'ext-server-1',
      });

      // Simulate: external server sends token to validation endpoint
      const payload = validateDelegationToken(token);
      expect(payload.sub).toBe('user-200');
      expect(payload.scopes).toEqual(['mcp:tool:call', 'oauth:github:read']);
      expect(payload.workflowId).toBe('wf-abc');
      expect(payload.serverId).toBe('ext-server-1');
      expect(payload.type).toBe('delegation');
    });

    it('should reject tampered token', () => {
      const token = createDelegationToken('user-201', ['files:read'], 300);
      // Tamper with the token
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(() => validateDelegationToken(tampered)).toThrow();
    });
  });

  describe('scope granularity', () => {
    it('should support provider-specific OAuth scopes', () => {
      const token = createDelegationToken('user-300', [
        'oauth:google:read',
        'oauth:github:read',
        'files:read',
        'files:write',
      ], 300);
      const payload = validateDelegationToken(token);

      expect(() => requireScope(payload, 'oauth:google:read')).not.toThrow();
      expect(() => requireScope(payload, 'oauth:github:read')).not.toThrow();
      expect(() => requireScope(payload, 'files:read')).not.toThrow();
      expect(() => requireScope(payload, 'files:write')).not.toThrow();

      // Not granted
      expect(() => requireScope(payload, 'oauth:microsoft:read')).toThrow();
      expect(() => requireScope(payload, 'admin:users')).toThrow();
    });
  });

  describe('MCP tool auth context injection', () => {
    it('should create delegation token from orchestrator userId', () => {
      // Simulates what system/activities/triage/tools.ts does:
      // const orchCtx = getOrchestratorContext();
      // const authContext = orchCtx?.userId
      //   ? { userId: orchCtx.userId, delegationToken: createDelegationToken(...) }
      //   : undefined;
      const userId = 'user-400';
      const delegationToken = createDelegationToken(userId, ['mcp:tool:call']);

      // The auth context that would be passed to callServerTool
      const authContext = { userId, delegationToken };

      // The _auth object injected into tool args
      const toolArgs = {
        query: 'test',
        _auth: { userId: authContext.userId, token: authContext.delegationToken },
      };

      // External server extracts and validates
      const payload = validateDelegationToken(toolArgs._auth.token);
      expect(payload.sub).toBe('user-400');
      expect(payload.scopes).toContain('mcp:tool:call');
    });

    it('should not inject auth context when no userId available', () => {
      // Cron-triggered workflows have no userId
      const orchCtxUserId: string | undefined = undefined;
      const authContext = orchCtxUserId
        ? { userId: orchCtxUserId, delegationToken: createDelegationToken(orchCtxUserId, ['mcp:tool:call']) }
        : undefined;

      expect(authContext).toBeUndefined();

      // Tool args have no _auth
      const toolArgs = { query: 'test' };
      expect((toolArgs as any)._auth).toBeUndefined();
    });
  });
});
