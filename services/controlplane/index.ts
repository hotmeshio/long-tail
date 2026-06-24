import { HotMesh } from '@hotmeshio/hotmesh';
import type { QuorumProfile, ThrottleOptions } from '@hotmeshio/hotmesh/build/types/quorum';

import { getPool, getConnection } from '../../lib/db';
import { LIST_APPS, COUNT_PENDING, COUNT_PROCESSED_SINCE, VOLUME_BY_STREAM } from './sql';
import {
  LIST_STREAM_MESSAGES,
  COUNT_STREAM_MESSAGES,
  VALID_SORT_COLUMNS,
  VALID_SORT_ORDERS,
} from './stream-messages-sql';
import { startQuorumBridge } from './quorum-bridge';
import type { ControlPlaneApp, StreamStats, StreamMessagesParams, StreamMessagesResult, StreamMessage } from './types';

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
      connection: getConnection(),
    },
  });
  engines.set(appId, engine);
  return engine;
}

// ─── Application discovery ──────────────────────────────────────────────────

/**
 * List all active HotMesh application IDs from the `hmsh_applications` table.
 */
export async function listApps(): Promise<ControlPlaneApp[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ app_id: string; version: string }>(LIST_APPS);
  return rows.map((r) => ({
    appId: r.app_id,
    version: r.version,
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

  // Graceful degradation: HotMesh schema may not exist if no engine has started.
  const emptyCount = { rows: [{ count: 0 }] };
  const [pendingRes, processedRes, byStreamRes] = await Promise.all([
    pool.query<{ count: number }>(COUNT_PENDING(schema), [stream]).catch(() => emptyCount),
    pool.query<{ count: number }>(COUNT_PROCESSED_SINCE(schema), [interval, stream]).catch(() => emptyCount),
    pool.query<{ stream_type: 'engine' | 'worker'; stream_name: string; count: number }>(VOLUME_BY_STREAM(schema), [interval, stream]).catch(() => ({ rows: [] as any[] })),
  ]);

  return {
    pending: pendingRes.rows[0]?.count ?? 0,
    processed: processedRes.rows[0]?.count ?? 0,
    byStream: byStreamRes.rows,
  };
}

// ─── Stream message browsing ────────────────────────────────────────────

/**
 * Browse stream messages across engine_streams and worker_streams tables
 * with pagination, filtering, and sorting.
 *
 * @param schema — the Postgres schema (namespace, e.g. "durable")
 * @param params — pagination, filter, and sort options
 */
export async function getStreamMessages(
  schema: string,
  params: StreamMessagesParams,
): Promise<StreamMessagesResult> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  const sortColumn = VALID_SORT_COLUMNS[params.sort_by ?? 'created_at'];
  if (!sortColumn) throw new Error(`Invalid sort_by: ${params.sort_by}`);

  const sortOrder = (params.order ?? 'desc').toLowerCase();
  if (!VALID_SORT_ORDERS.has(sortOrder)) throw new Error(`Invalid order: ${params.order}`);

  const { source } = params;
  const streamName = params.stream_name ? `%${params.stream_name}%` : null;
  const status = params.status ?? null;
  const msgType = params.msg_type ?? null;
  const topic = params.topic ?? null;
  const workflowName = params.workflow_name ?? null;
  const jid = params.jid ?? null;
  const aid = params.aid ?? null;
  const dad = params.dad ?? null;

  const pool = getPool();
  const queryParams = [streamName, status, msgType, topic, workflowName, jid, aid, dad, limit, offset];
  const countParams = [streamName, status, msgType, topic, workflowName, jid, aid, dad];

  const [messagesRes, countRes] = await Promise.all([
    pool.query<StreamMessage>(
      LIST_STREAM_MESSAGES(schema, sortColumn, sortOrder, source),
      queryParams,
    ).catch(() => ({ rows: [] as StreamMessage[] })),
    pool.query<{ count: number }>(
      COUNT_STREAM_MESSAGES(schema, source),
      countParams,
    ).catch(() => ({ rows: [{ count: 0 }] })),
  ]);

  return {
    messages: messagesRes.rows,
    total: countRes.rows[0]?.count ?? 0,
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
