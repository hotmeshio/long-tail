import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { connectTelemetry, disconnectTelemetry } from '../../setup/telemetry';
import { migrate } from '../../../lib/db/migrate';
import * as escalationService from '../../../services/escalation';
import { resetStationMetricsCache } from '../../../services/escalation/queries';
import * as userService from '../../../services/user';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// Escalation Service
//
// Escalations are the human-in-the-loop mechanism. When a workflow cannot
// proceed automatically, it creates an escalation assigned to a role.
// Users claim escalations, review the data, and resolve them — which
// signals the paused workflow to continue.
//
// This suite walks through the full escalation lifecycle:
//   1. Create escalations across roles and types
//   2. Claim an escalation (lock it for a user)
//   3. Query statistics (global, role-scoped, time-windowed)
//   4. List and filter escalations with RBAC scoping
//   5. List available (unclaimed) escalations
// ─────────────────────────────────────────────────────────────────────────────

describe('escalation service', () => {
  let userId: string;
  let escalationIds: string[] = [];

  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();

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
    // Clean up test escalations
    const { getPool } = await import('../../../lib/db');
    const pool = getPool();
    await pool.query(
      'DELETE FROM lt_escalations WHERE id = ANY($1::uuid[])',
      [escalationIds],
    );
    await userService.deleteUser(userId);
    await Durable.shutdown();
    await disconnectTelemetry();
  }, 10_000);

  // ── 1. Create and claim ────────────────────────────────────────────────
  //
  // Seed escalations across two roles (reviewer, engineer) and one
  // resolved record. Then claim one to set up state for stats queries.

  describe('create and claim', () => {
    it('should create escalations across roles and types', async () => {
      // 3 pending reviewer escalations (one high-priority)
      for (let i = 0; i < 3; i++) {
        const esc = await escalationService.createEscalation({
          type: 'document',
          subtype: 'verify',
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
          role: 'engineer',
          envelope: JSON.stringify({ data: {} }),
        });
        escalationIds.push(esc.id);
      }

      // 1 resolved escalation (for resolved_* stats)
      const resolved = await escalationService.createEscalation({
        type: 'document',
        subtype: 'verify',
        role: 'reviewer',
        envelope: JSON.stringify({ data: {} }),
      });
      await escalationService.resolveEscalation(resolved.id, { ok: true });
      escalationIds.push(resolved.id);

      expect(escalationIds).toHaveLength(6);
    });

    it('should claim an escalation and record assignment', async () => {
      const result = await escalationService.claimEscalation(
        escalationIds[0],
        userId,
        60,
      );
      expect(result).toBeTruthy();
      expect(result!.escalation.assigned_to).toBe(userId);
    });
  });

  // ── 2. Statistics ──────────────────────────────────────────────────────
  //
  // Stats aggregate escalation counts by status, role, and type.
  // RBAC scoping ensures users only see stats for their own roles.

  describe('statistics', () => {
    // Stats are cached briefly in the service; clear so each assertion reads fresh
    // aggregates rather than a value cached by a sibling test.
    beforeEach(() => resetStationMetricsCache());

    it('should return global stats (no role filter)', async () => {
      const stats = await escalationService.getEscalationStats();

      expect(stats.pending).toBeGreaterThanOrEqual(5);
      expect(stats.claimed).toBeGreaterThanOrEqual(1);
      expect(stats.created).toBeGreaterThanOrEqual(6);
      expect(stats.resolved).toBeGreaterThanOrEqual(1);

      expect(stats.by_role.length).toBeGreaterThanOrEqual(2);
      const reviewer = stats.by_role.find(r => r.role === 'reviewer');
      expect(reviewer).toBeTruthy();
      expect(reviewer!.pending).toBeGreaterThanOrEqual(3);
      expect(reviewer!.claimed).toBeGreaterThanOrEqual(1);

      expect(stats.by_type.length).toBeGreaterThanOrEqual(1);
    });

    it('should scope stats by visible roles', async () => {
      const stats = await escalationService.getEscalationStats(['reviewer']);

      expect(stats.pending).toBeGreaterThanOrEqual(3);
      expect(stats.by_role.every(r => r.role === 'reviewer')).toBe(true);

      const engineer = stats.by_role.find(r => r.role === 'engineer');
      expect(engineer).toBeUndefined();
    });

    it('should return zeros for empty role set', async () => {
      const stats = await escalationService.getEscalationStats(['nonexistent-role']);

      expect(stats.pending).toBe(0);
      expect(stats.claimed).toBe(0);
      expect(stats.created).toBe(0);
      expect(stats.resolved).toBe(0);
      expect(stats.by_role).toHaveLength(0);
      expect(stats.by_type).toHaveLength(0);
    });

    it('should widen counts with longer time periods', async () => {
      const stats1h = await escalationService.getEscalationStats(undefined, '1h');
      const stats7d = await escalationService.getEscalationStats(undefined, '7d');
      const stats30d = await escalationService.getEscalationStats(undefined, '30d');

      expect(stats7d.created).toBeGreaterThanOrEqual(stats1h.created);
      expect(stats30d.created).toBeGreaterThanOrEqual(stats7d.created);
    });

    it('should return distinct type values sorted alphabetically', async () => {
      const types = await escalationService.listDistinctTypes();

      expect(types).toContain('document');
      expect(types).toContain('content');
      // ordering comes from the database's linguistic collation (ORDER BY
      // type), so assert with a locale-aware comparator — code-unit sort()
      // disagrees when case mixes mid-word (e.g. printOrder vs printer)
      expect(types).toEqual([...types].sort((a, b) => a.localeCompare(b)));
    });
  });

  // ── 3. List and filter ─────────────────────────────────────────────────
  //
  // Listing supports filtering by status, type, role, and RBAC-scoped
  // visible roles. Results are paginated and sorted by priority.

  describe('list and filter', () => {
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

    it('should sort by priority ASC, created_at ASC by default', async () => {
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

    it('should paginate with limit and offset', async () => {
      const page1 = await escalationService.listEscalations({ limit: 2, offset: 0 });
      const page2 = await escalationService.listEscalations({ limit: 2, offset: 2 });

      expect(page1.escalations).toHaveLength(2);
      expect(page1.total).toBe(page2.total);

      const ids1 = new Set(page1.escalations.map(e => e.id));
      expect(page2.escalations.every(e => !ids1.has(e.id))).toBe(true);
    });
  });

  // ── 4. Available escalations ───────────────────────────────────────────
  //
  // "Available" means pending AND unclaimed (or claim expired). This is
  // the queue a human reviewer pulls from.

  describe('available escalations', () => {
    it('should only return pending, unassigned escalations', async () => {
      const result = await escalationService.listAvailableEscalations({});

      expect(result.escalations.every(e => e.status === 'pending')).toBe(true);
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

  // ── 5. Metadata candidate key operations ─────────────────────────────
  //
  // Verify that findByMetadata, claimByMetadata (with metadata merge),
  // hit real SQL against Postgres.

  describe('metadata candidate key', () => {
    let metaEscId: string;

    it('should create an escalation with metadata for lookup', async () => {
      const esc = await escalationService.createEscalation({
        type: 'order',
        subtype: 'station',
        role: 'reviewer',
        envelope: '{}',
        metadata: { orderId: 'meta-test-order-1', station: 'scanning' },
      });
      metaEscId = esc.id;
      escalationIds.push(esc.id);
      expect(esc.metadata).toEqual({ orderId: 'meta-test-order-1', station: 'scanning' });
    });

    it('should find escalation by metadata key', async () => {
      const result = await escalationService.findByMetadata('orderId', 'meta-test-order-1');
      expect(result.total).toBe(1);
      expect(result.escalations[0].id).toBe(metaEscId);
    });

    it('should find nothing for non-matching metadata', async () => {
      const result = await escalationService.findByMetadata('orderId', 'does-not-exist');
      expect(result.total).toBe(0);
    });

    it('should claim by metadata and merge additional metadata in one SQL call', async () => {
      const result = await escalationService.claimByMetadata(
        'orderId', 'meta-test-order-1', userId, 30,
        { claimedBy: 'jimbo', workstation: 'ws-7' },
      );
      expect(result).not.toBeNull();
      expect(result!.escalation.assigned_to).toBe(userId);
      expect(result!.escalation.metadata).toMatchObject({
        orderId: 'meta-test-order-1',
        station: 'scanning',
        claimedBy: 'jimbo',
        workstation: 'ws-7',
      });
      expect(result!.isExtension).toBe(false);
    });

    it('should preserve original metadata keys after merge', async () => {
      const esc = await escalationService.getEscalation(metaEscId);
      expect(esc!.metadata).toMatchObject({
        orderId: 'meta-test-order-1',
        station: 'scanning',
        claimedBy: 'jimbo',
      });
    });

    it('should return null when claiming non-matching metadata', async () => {
      const result = await escalationService.claimByMetadata(
        'orderId', 'nonexistent', userId, 30,
      );
      expect(result).toBeNull();
    });
  });
});
