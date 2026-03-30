import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

import { config } from '../../../modules/config';
import {
  createDelegationToken,
  validateDelegationToken,
  requireScope,
} from '../../../services/auth/delegation';

const TEST_SECRET = 'delegation-test-secret';

describe('Delegation tokens', () => {
  beforeAll(() => {
    (config as any).JWT_SECRET = TEST_SECRET;
  });

  it('should create a valid delegation token', () => {
    const token = createDelegationToken('user-1', ['oauth:google:read', 'files:read']);
    const decoded = jwt.verify(token, TEST_SECRET) as any;
    expect(decoded.type).toBe('delegation');
    expect(decoded.sub).toBe('user-1');
    expect(decoded.scopes).toEqual(['oauth:google:read', 'files:read']);
    expect(decoded.iss).toBe('long-tail');
  });

  it('should validate a delegation token', () => {
    const token = createDelegationToken('user-2', ['mcp:tool:call']);
    const payload = validateDelegationToken(token);
    expect(payload.sub).toBe('user-2');
    expect(payload.scopes).toEqual(['mcp:tool:call']);
    expect(payload.type).toBe('delegation');
  });

  it('should reject an expired token', async () => {
    const token = createDelegationToken('user-3', ['files:read'], 0);
    // Wait for expiry (JWT minimum granularity is 1 second)
    await new Promise((r) => setTimeout(r, 1100));
    expect(() => validateDelegationToken(token)).toThrow();
  });

  it('should reject a non-delegation JWT', () => {
    const token = jwt.sign({ userId: 'user-4', role: 'admin' }, TEST_SECRET, {
      issuer: 'long-tail',
    });
    expect(() => validateDelegationToken(token)).toThrow('not a delegation token');
  });

  it('should reject a token with wrong secret', () => {
    const token = jwt.sign(
      { type: 'delegation', sub: 'user-5', scopes: [] },
      'wrong-secret',
      { issuer: 'long-tail' },
    );
    expect(() => validateDelegationToken(token)).toThrow();
  });

  it('should enforce scope requirements', () => {
    const token = createDelegationToken('user-6', ['oauth:google:read']);
    const payload = validateDelegationToken(token);

    expect(() => requireScope(payload, 'oauth:google:read')).not.toThrow();
    expect(() => requireScope(payload, 'files:write')).toThrow('missing required scope');
  });

  it('should respect custom TTL', () => {
    const token = createDelegationToken('user-7', ['files:read'], 3600);
    const decoded = jwt.decode(token) as any;
    const ttl = decoded.exp - decoded.iat;
    expect(ttl).toBe(3600);
  });

  it('should clamp TTL to max 1 hour', () => {
    const token = createDelegationToken('user-8', [], 99999);
    const decoded = jwt.decode(token) as any;
    const ttl = decoded.exp - decoded.iat;
    expect(ttl).toBe(3600);
  });

  it('should include optional workflowId and serverId', () => {
    const token = createDelegationToken('user-9', ['mcp:tool:call'], 300, {
      workflowId: 'wf-123',
      serverId: 'ext-server',
    });
    const payload = validateDelegationToken(token);
    expect(payload.workflowId).toBe('wf-123');
    expect(payload.serverId).toBe('ext-server');
  });
});
