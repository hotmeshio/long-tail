import { describe, it, expect, beforeAll, vi } from 'vitest';

import { config } from '../../../modules/config';
import { resolveToolContext } from '../../../services/iam/resolve';

const TEST_SECRET = 'resolve-test-secret';

// Mock user service to avoid DB dependency
vi.mock('../../../services/user', () => ({
  getUser: vi.fn(async (id: string) => {
    if (id === 'known-user') {
      return { id: 'known-user', display_name: 'Test User', metadata: { account_type: 'user' } };
    }
    if (id === 'known-bot') {
      return { id: 'known-bot', display_name: 'CI Bot', metadata: { account_type: 'bot' } };
    }
    return null;
  }),
  getUserRoles: vi.fn(async (id: string) => {
    if (id === 'known-user') {
      return [
        { role: 'reviewer', type: 'member', created_at: new Date() },
        { role: 'engineer', type: 'admin', created_at: new Date() },
      ];
    }
    if (id === 'known-bot') {
      return [{ role: 'scheduler', type: 'member', created_at: new Date() }];
    }
    return [];
  }),
}));

describe('resolveToolContext', () => {
  beforeAll(() => {
    (config as any).JWT_SECRET = TEST_SECRET;
  });

  it('returns null when no userId is available', async () => {
    const result = await resolveToolContext({});
    expect(result).toBeNull();
  });

  // ── userId resolution priority ──

  it('prefers _auth.userId over other sources', async () => {
    const result = await resolveToolContext({
      _auth: { userId: 'from-auth' },
      userId: 'from-explicit',
      envelope: { data: {}, metadata: {}, lt: { userId: 'from-envelope' } },
      orchestratorContext: { workflowId: 'w1', taskQueue: 'q1', workflowType: 'test', userId: 'from-orch' },
    });
    expect(result!.principal.id).toBe('from-auth');
  });

  it('falls back to explicit userId when no _auth', async () => {
    const result = await resolveToolContext({
      userId: 'from-explicit',
      envelope: { data: {}, metadata: {}, lt: { userId: 'from-envelope' } },
    });
    expect(result!.principal.id).toBe('from-explicit');
  });

  it('falls back to envelope.lt.userId', async () => {
    const result = await resolveToolContext({
      envelope: { data: {}, metadata: {}, lt: { userId: 'from-envelope' } },
    });
    expect(result!.principal.id).toBe('from-envelope');
  });

  it('falls back to orchestratorContext.userId', async () => {
    const result = await resolveToolContext({
      orchestratorContext: { workflowId: 'w1', taskQueue: 'q1', workflowType: 'test', userId: 'from-orch' },
    });
    expect(result!.principal.id).toBe('from-orch');
  });

  // ── Principal resolution ──

  it('loads roles and determines highest role type', async () => {
    const result = await resolveToolContext({ userId: 'known-user' });
    expect(result!.principal.roles).toEqual(['reviewer', 'engineer']);
    expect(result!.principal.roleType).toBe('admin'); // admin > member
    expect(result!.principal.displayName).toBe('Test User');
  });

  it('resolves bot account type from metadata', async () => {
    const result = await resolveToolContext({ userId: 'known-bot' });
    expect(result!.principal.type).toBe('bot');
    expect(result!.principal.roles).toEqual(['scheduler']);
  });

  it('respects explicit accountType override', async () => {
    const result = await resolveToolContext({ userId: 'known-user', accountType: 'bot' });
    expect(result!.principal.type).toBe('bot');
  });

  it('falls back gracefully when user not found in DB', async () => {
    const result = await resolveToolContext({ userId: 'unknown-user' });
    expect(result!.principal.id).toBe('unknown-user');
    expect(result!.principal.type).toBe('user');
    expect(result!.principal.roles).toEqual([]);
  });

  // ── Credentials ──

  it('mints a delegation token with default scopes', async () => {
    const result = await resolveToolContext({ userId: 'known-user' });
    expect(result!.credentials.delegationToken).toBeDefined();
    expect(result!.credentials.scopes).toEqual(['mcp:tool:call']);
  });

  it('uses custom scopes when provided', async () => {
    const result = await resolveToolContext({
      userId: 'known-user',
      scopes: ['oauth:anthropic:read', 'files:write'],
    });
    expect(result!.credentials.scopes).toEqual(['oauth:anthropic:read', 'files:write']);
  });

  it('reuses existing delegation token from _auth', async () => {
    const result = await resolveToolContext({
      _auth: { userId: 'known-user', token: 'existing-token' },
    });
    expect(result!.credentials.delegationToken).toBe('existing-token');
  });

  // ── Trace ──

  it('populates trace from envelope and orchestrator context', async () => {
    const result = await resolveToolContext({
      userId: 'known-user',
      envelope: { data: {}, metadata: {}, lt: { userId: 'known-user', originId: 'origin-1', parentId: 'parent-1' } },
      orchestratorContext: { workflowId: 'wf-1', taskQueue: 'q1', workflowType: 'test' },
      traceId: 'trace-abc',
      spanId: 'span-xyz',
    });
    expect(result!.trace).toEqual({
      originId: 'origin-1',
      parentId: 'parent-1',
      workflowId: 'wf-1',
      traceId: 'trace-abc',
      spanId: 'span-xyz',
    });
  });
});
