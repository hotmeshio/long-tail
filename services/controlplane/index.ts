import { HotMesh } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type { QuorumProfile, ThrottleOptions } from '@hotmeshio/hotmesh/build/types/quorum';

import { postgres_options } from '../../modules/config';
import { getPool } from '../../lib/db';
import { LIST_APPS, COUNT_PENDING, COUNT_PROCESSED_SINCE, VOLUME_BY_STREAM } from './sql';
import { startQuorumBridge } from './quorum-bridge';
import type { ControlPlaneApp, StreamStats } from './types';

// Re-export for consumers
export type { QuorumProfile, ThrottleOptions };

// ─── Engine cache ───────────────────────────────────────────────────────────

/** Cached read-only HotMesh engines keyed by appId */
const engines = new Map<string, HotMesh>();

/**
 * Get or create a read-only HotMesh engine for control plane operations.
 * The engine taps into the Postgres quorum channel for the given appId,
 * enabling rollCall and throttle without running any workflows.
 */
export async function getEngine(appId: string): Promise<HotMesh> {
  const cached = engines.get(appId);
  if (cached) return cached;

  const engine = await HotMesh.init({
    appId,
    guid: `controlplane::${appId}-${HotMesh.guid()}`,
    engine: {
      connection: { class: Postgres, options: postgres_options },
    },
  });
  engines.set(appId, engine);
  return engine;
}

// ─── Application discovery ──────────────────────────────────────────────────

/**
 * List all HotMesh application IDs from the `hotmesh_applications` table.
 * Excludes soft-deleted (expired) entries.
 */
export async function listApps(): Promise<ControlPlaneApp[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ key: string }>(LIST_APPS);
  return rows.map((r) => ({
    appId: r.key.replace('hmsh:a:', ''),
  }));
}

// ─── Roll call ──────────────────────────────────────────────────────────────

/**
 * Execute a roll call against the mesh for a given appId.
 * Broadcasts a ping and collects pong responses from all engines and workers.
 */
export async function rollCall(
  appId: string,
  delay?: number,
): Promise<QuorumProfile[]> {
  const engine = await getEngine(appId);
  return engine.rollCall(delay);
}

// ─── Throttle ───────────────────────────────────────────────────────────────

/**
 * Broadcast a throttle command to the mesh.
 *
 * @param appId — target application
 * @param options.throttle — ms delay per message (-1 = pause, 0 = resume)
 * @param options.topic — target a specific worker topic
 * @param options.guid — target a specific engine/worker by GUID
 */
export async function applyThrottle(
  appId: string,
  options: ThrottleOptions,
): Promise<boolean> {
  const engine = await getEngine(appId);
  return engine.throttle(options);
}

// ─── Stream statistics ──────────────────────────────────────────────────────

/** Valid interval values (whitelist to prevent injection) */
const VALID_INTERVALS: Record<string, string> = {
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h': '1 hour',
  '1d': '1 day',
  '7d': '7 days',
};

/**
 * Get stream processing statistics for a given appId schema.
 *
 * @param schema — the Postgres schema (appId, e.g. "durable")
 * @param duration — time range key (15m, 30m, 1h, 1d, 7d)
 * @param streamName — optional: filter to a specific stream (task queue topic)
 */
export async function getStreamStats(
  schema: string,
  duration: string = '1h',
  streamName?: string | null,
): Promise<StreamStats> {
  const interval = VALID_INTERVALS[duration];
  if (!interval) throw new Error(`Invalid duration: ${duration}`);

  const pool = getPool();
  const stream = streamName || null;

  const [pendingRes, processedRes, byStreamRes] = await Promise.all([
    pool.query<{ count: number }>(COUNT_PENDING(schema), [stream]),
    pool.query<{ count: number }>(COUNT_PROCESSED_SINCE(schema), [interval, stream]),
    pool.query<{ stream_type: 'engine' | 'worker'; stream_name: string; count: number }>(VOLUME_BY_STREAM(schema), [interval, stream]),
  ]);

  return {
    pending: pendingRes.rows[0]?.count ?? 0,
    processed: processedRes.rows[0]?.count ?? 0,
    byStream: byStreamRes.rows,
  };
}

// ─── Quorum bridge ──────────────────────────────────────────────────────────

/** Track which appIds have active quorum bridges */
const activeBridges = new Set<string>();

/**
 * Start the quorum→NATS bridge for an appId.
 * Subscribes to the HotMesh quorum channel and republishes
 * messages to NATS on `lt.mesh.*` topics.
 */
export async function subscribeMesh(appId: string): Promise<void> {
  if (activeBridges.has(appId)) return;
  const engine = await getEngine(appId);
  await startQuorumBridge(engine, appId);
  activeBridges.add(appId);
}

/**
 * Check if a quorum bridge is active for an appId.
 */
export function isBridgeActive(appId: string): boolean {
  return activeBridges.has(appId);
}
