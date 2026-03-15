import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from './setup';
import { connectTelemetry, disconnectTelemetry } from './setup/telemetry';
import { migrate } from '../services/db/migrate';
import * as controlplane from '../services/controlplane';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// Control Plane
//
// The control plane service wraps HotMesh's rollCall and throttle APIs
// to provide mesh observability and throttle control.
//
// This suite walks through:
//   1. Listing available HotMesh applications
//   2. Executing a roll call to discover mesh members
//   3. Applying throttle commands
// ─────────────────────────────────────────────────────────────────────────────

describe('control plane', () => {
  beforeAll(async () => {
    await connectTelemetry();
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();
  });

  afterAll(async () => {
    await disconnectTelemetry();
  });

  // ── App discovery ─────────────────────────────────────────────────────────

  describe('listApps', () => {
    it('should discover apps from hotmesh_applications table', async () => {
      const apps = await controlplane.listApps();
      // After migrations, at least "durable" and "hmsh" exist
      expect(apps.length).toBeGreaterThanOrEqual(1);
      const appIds = apps.map((a) => a.appId);
      expect(appIds).toContain('durable');
    });
  });

  // ── Roll call ─────────────────────────────────────────────────────────────

  describe('rollCall', () => {
    it('should return an array of profiles', async () => {
      const profiles = await controlplane.rollCall('durable');
      // In test env with no running workers, may be empty or have just the engine
      expect(Array.isArray(profiles)).toBe(true);
    });

    it('should return profiles with expected shape', async () => {
      const profiles = await controlplane.rollCall('durable');
      for (const p of profiles) {
        expect(p).toHaveProperty('namespace');
        expect(p).toHaveProperty('app_id');
        expect(p).toHaveProperty('engine_id');
      }
    });
  });

  // ── Stream statistics ────────────────────────────────────────────────────

  describe('getStreamStats', () => {
    it('should return pending and processed counts', async () => {
      const stats = await controlplane.getStreamStats('durable', '1h');
      expect(typeof stats.pending).toBe('number');
      expect(typeof stats.processed).toBe('number');
      expect(stats.pending).toBeGreaterThanOrEqual(0);
      expect(stats.processed).toBeGreaterThanOrEqual(0);
    });

    it('should return volume breakdown by stream', async () => {
      const stats = await controlplane.getStreamStats('durable', '1d');
      expect(Array.isArray(stats.byStream)).toBe(true);
      for (const entry of stats.byStream) {
        expect(entry).toHaveProperty('stream_name');
        expect(entry).toHaveProperty('count');
        expect(typeof entry.count).toBe('number');
      }
    });

    it('should reject invalid durations', async () => {
      await expect(controlplane.getStreamStats('durable', 'bad')).rejects.toThrow('Invalid duration');
    });
  });

  // ── Throttle ──────────────────────────────────────────────────────────────

  describe('applyThrottle', () => {
    it('should accept a throttle command without error', async () => {
      // Resume (throttle: 0) is always safe — it's a no-op if not throttled
      const result = await controlplane.applyThrottle('durable', { throttle: 0 });
      expect(typeof result).toBe('boolean');
    });

    it('should accept a topic-scoped throttle', async () => {
      const result = await controlplane.applyThrottle('durable', {
        throttle: 0,
        topic: 'nonexistent-topic',
      });
      expect(typeof result).toBe('boolean');
    });
  });
});
