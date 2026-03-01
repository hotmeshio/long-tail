import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from './setup';
import { connectTelemetry, disconnectTelemetry } from './setup/telemetry';
import { migrate } from '../services/db/migrate';
import * as escalationService from '../services/escalation';
import * as userService from '../services/user';

const { Connection } = Durable;

describe('Escalation service', () => {
  let userId: string;
  let escalationIds: string[] = [];

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

    // Create a test user with a role for RBAC tests
    const user = await userService.createUser({
      external_id: `esc-test-${Date.now()}`,
      email: 'esc-test@example.com',
      roles: [
        { role: 'reviewer', type: 'member' },
        { role: 'engineer', type: 'admin' },
      ],
    });
    userId = user.id;
  }, 30_000);

  afterAll(async () => {
    await userService.deleteUser(userId);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── Seed test data ───────────────────────────────────────────────────────

  it('should create escalations for stats testing', async () => {
    // 3 pending reviewer escalations
    for (let i = 0; i < 3; i++) {
      const esc = await escalationService.createEscalation({
        type: 'document',
        subtype: 'verify',
        modality: 'portal',
        role: 'reviewer',
        envelope: JSON.stringify({ data: { idx: i } }),
        priority: i === 0 ? 1 : 2,
      });
      escalationIds.push(esc.id);
    }

    // 2 pending engineer escalations
    for (let i = 0; i < 2; i++) {
      const esc = await escalationService.createEscalation({
        type: 'content',
        subtype: 'review',
        modality: 'default',
        role: 'engineer',
        envelope: JSON.stringify({ data: {} }),
      });
      escalationIds.push(esc.id);
    }

    // 1 resolved escalation (for resolved_* stats)
    const resolved = await escalationService.createEscalation({
      type: 'document',
      subtype: 'verify',
      modality: 'portal',
      role: 'reviewer',
      envelope: JSON.stringify({ data: {} }),
    });
    await escalationService.resolveEscalation(resolved.id, { ok: true });
    escalationIds.push(resolved.id);

    expect(escalationIds).toHaveLength(6);
  });

  // ── Claim one escalation ─────────────────────────────────────────────────

  it('should claim an escalation for claimed stats', async () => {
    const result = await escalationService.claimEscalation(
      escalationIds[0],
      userId,
      60,
    );
    expect(result).toBeTruthy();
    expect(result!.escalation.assigned_to).toBe(userId);
  });

  // ── Stats ────────────────────────────────────────────────────────────────

  describe('getEscalationStats', () => {
    it('should return global stats (no role filter)', async () => {
      const stats = await escalationService.getEscalationStats();

      // 5 pending (3 reviewer + 2 engineer), 1 resolved
      expect(stats.pending).toBeGreaterThanOrEqual(5);
      expect(stats.claimed).toBeGreaterThanOrEqual(1);
      expect(stats.created_24h).toBeGreaterThanOrEqual(6);
      expect(stats.created_1h).toBeGreaterThanOrEqual(6);
      expect(stats.resolved_24h).toBeGreaterThanOrEqual(1);
      expect(stats.resolved_1h).toBeGreaterThanOrEqual(1);

      // by_role breakdown
      expect(stats.by_role.length).toBeGreaterThanOrEqual(2);
      const reviewer = stats.by_role.find(r => r.role === 'reviewer');
      expect(reviewer).toBeTruthy();
      expect(reviewer!.pending).toBeGreaterThanOrEqual(3);
      expect(reviewer!.claimed).toBeGreaterThanOrEqual(1);
    });

    it('should scope stats by visible roles', async () => {
      const stats = await escalationService.getEscalationStats(['reviewer']);

      // Only reviewer data should be counted
      expect(stats.pending).toBeGreaterThanOrEqual(3);
      expect(stats.by_role.every(r => r.role === 'reviewer')).toBe(true);

      // Engineer escalations should NOT be counted
      const engineer = stats.by_role.find(r => r.role === 'engineer');
      expect(engineer).toBeUndefined();
    });

    it('should return zeros for empty role set', async () => {
      const stats = await escalationService.getEscalationStats(['nonexistent-role']);

      expect(stats.pending).toBe(0);
      expect(stats.claimed).toBe(0);
      expect(stats.created_1h).toBe(0);
      expect(stats.created_24h).toBe(0);
      expect(stats.resolved_1h).toBe(0);
      expect(stats.resolved_24h).toBe(0);
      expect(stats.by_role).toHaveLength(0);
    });
  });

  // ── Distinct types ───────────────────────────────────────────────────────

  describe('listDistinctTypes', () => {
    it('should return distinct type values', async () => {
      const types = await escalationService.listDistinctTypes();

      expect(types).toContain('document');
      expect(types).toContain('content');
      // Should be sorted
      expect(types).toEqual([...types].sort());
    });
  });

  // ── List / Available with sorting ────────────────────────────────────────

  describe('listEscalations', () => {
    it('should return escalations with total count', async () => {
      const result = await escalationService.listEscalations({});

      expect(result.escalations.length).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThanOrEqual(result.escalations.length);
    });

    it('should filter by status', async () => {
      const result = await escalationService.listEscalations({ status: 'resolved' });

      expect(result.escalations.every(e => e.status === 'resolved')).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it('should filter by type', async () => {
      const result = await escalationService.listEscalations({ type: 'document' });

      expect(result.escalations.every(e => e.type === 'document')).toBe(true);
    });

    it('should scope by visible roles', async () => {
      const result = await escalationService.listEscalations({
        visibleRoles: ['reviewer'],
      });

      expect(result.escalations.every(e => e.role === 'reviewer')).toBe(true);
    });

    it('should sort by priority ASC, created_at ASC', async () => {
      const result = await escalationService.listEscalations({});

      for (let i = 1; i < result.escalations.length; i++) {
        const prev = result.escalations[i - 1];
        const curr = result.escalations[i];
        if (prev.priority === curr.priority) {
          expect(new Date(prev.created_at).getTime())
            .toBeLessThanOrEqual(new Date(curr.created_at).getTime());
        } else {
          expect(prev.priority).toBeLessThan(curr.priority);
        }
      }
    });

    it('should respect limit and offset', async () => {
      const page1 = await escalationService.listEscalations({ limit: 2, offset: 0 });
      const page2 = await escalationService.listEscalations({ limit: 2, offset: 2 });

      expect(page1.escalations).toHaveLength(2);
      expect(page1.total).toBe(page2.total);
      // Pages should not overlap
      const ids1 = new Set(page1.escalations.map(e => e.id));
      expect(page2.escalations.every(e => !ids1.has(e.id))).toBe(true);
    });
  });

  describe('listAvailableEscalations', () => {
    it('should only return pending, unassigned escalations', async () => {
      const result = await escalationService.listAvailableEscalations({});

      expect(result.escalations.every(e => e.status === 'pending')).toBe(true);
      // All should be either unassigned or have expired claims
      for (const esc of result.escalations) {
        if (esc.assigned_to) {
          expect(new Date(esc.assigned_until!).getTime())
            .toBeLessThanOrEqual(Date.now());
        }
      }
    });

    it('should scope by visible roles', async () => {
      const result = await escalationService.listAvailableEscalations({
        visibleRoles: ['engineer'],
      });

      expect(result.escalations.every(e => e.role === 'engineer')).toBe(true);
    });
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────

  it('should clean up test escalations', async () => {
    const { getPool } = await import('../services/db');
    const pool = getPool();
    await pool.query(
      'DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])',
      [escalationIds],
    );
  });
});
