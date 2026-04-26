/**
 * Standalone Escalation — integration test for creating escalations
 * without an associated workflow.
 *
 * Exercises the full lifecycle: create → list → claim → resolve.
 *
 * Requires: docker compose up -d --build (app + Postgres + Redis)
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { ApiClient, log } from './helpers';

const PASSWORD = 'l0ngt@1l';

let api: ApiClient;

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', PASSWORD);
  log('setup', 'superadmin logged in');
});

describe('Standalone Escalation', () => {
  let escalationId: string;

  it('creates a standalone escalation', async () => {
    const { status, data } = await api.post('/api/escalations', {
      type: 'support',
      subtype: 'account-merge',
      role: 'reviewer',
      description: 'Customer needs manual account merge',
      priority: 2,
      metadata: { customer_id: 'cust_123' },
    });

    expect(status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.type).toBe('support');
    expect(data.subtype).toBe('account-merge');
    expect(data.role).toBe('reviewer');
    expect(data.description).toBe('Customer needs manual account merge');
    expect(data.priority).toBe(2);
    expect(data.status).toBe('pending');
    expect(data.workflow_id).toBeNull();
    expect(data.task_id).toBeNull();
    expect(data.metadata).toEqual({ customer_id: 'cust_123' });

    escalationId = data.id;
    log('create', `escalation: ${escalationId}`);
  });

  it('appears in the escalation list filtered by role', async () => {
    const { data } = await api.get('/api/escalations', {
      role: 'reviewer',
      status: 'pending',
      sort_by: 'created_at',
      order: 'desc',
      limit: '10',
    });

    const found = data.escalations.find((e: any) => e.id === escalationId);
    expect(found).toBeDefined();
    expect(found.type).toBe('support');
  });

  it('can be claimed', async () => {
    const { status, data } = await api.post(`/api/escalations/${escalationId}/claim`);

    expect(status).toBe(200);
    expect(data.escalation.id).toBe(escalationId);
    expect(data.escalation.assigned_to).toBeDefined();
    expect(data.isExtension).toBe(false);
  });

  it('can be resolved with a payload', async () => {
    const { status, data } = await api.post(`/api/escalations/${escalationId}/resolve`, {
      resolverPayload: { merged: true, target_account: 'acct_456' },
    });

    expect(status).toBe(200);
    expect(data.acknowledged).toBe(true);
    expect(data.escalationId).toBe(escalationId);
  });

  it('is marked resolved after resolution', async () => {
    const { data } = await api.get(`/api/escalations/${escalationId}`);

    expect(data.status).toBe('resolved');
    expect(data.resolver_payload).toBeDefined();
    const payload = typeof data.resolver_payload === 'string'
      ? JSON.parse(data.resolver_payload)
      : data.resolver_payload;
    expect(payload.merged).toBe(true);
    expect(payload.target_account).toBe('acct_456');
  });
});

describe('Standalone Escalation — validation', () => {
  it('rejects missing type', async () => {
    const { status, data } = await api.post('/api/escalations', {
      role: 'reviewer',
    }).catch((err) => {
      const match = err.message.match(/→ (\d+): (.+)/);
      return { status: parseInt(match[1]), data: JSON.parse(match[2]) };
    });

    expect(status).toBe(400);
    expect(data.error).toContain('type');
  });

  it('rejects missing role', async () => {
    const { status, data } = await api.post('/api/escalations', {
      type: 'support',
    }).catch((err) => {
      const match = err.message.match(/→ (\d+): (.+)/);
      return { status: parseInt(match[1]), data: JSON.parse(match[2]) };
    });

    expect(status).toBe(400);
    expect(data.error).toContain('role');
  });

  it('defaults subtype to type when omitted', async () => {
    const { status, data } = await api.post('/api/escalations', {
      type: 'approval',
      role: 'reviewer',
    });

    expect(status).toBe(201);
    expect(data.subtype).toBe('approval');
  });

  it('defaults priority to 2 when omitted', async () => {
    const { status, data } = await api.post('/api/escalations', {
      type: 'task',
      role: 'reviewer',
    });

    expect(status).toBe(201);
    expect(data.priority).toBe(2);
  });
});
