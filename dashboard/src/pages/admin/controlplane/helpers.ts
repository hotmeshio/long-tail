import type { QuorumProfile } from '../../../api/controlplane';

export const DURATIONS = [
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '1d', value: '1d' },
  { label: '7d', value: '7d' },
] as const;

export type Duration = (typeof DURATIONS)[number]['value'];

export interface QuorumEvent {
  id: number;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export const EVENT_TYPE_COLORS: Record<string, string> = {
  pong: 'text-status-success',
  ping: 'text-accent',
  throttle: 'text-status-warning',
  job: 'text-purple-400',
  work: 'text-text-secondary',
  activate: 'text-status-error',
  cron: 'text-text-tertiary',
  user: 'text-text-secondary',
};

export const MAX_EVENTS = 250;

export function isWorker(p: QuorumProfile): boolean {
  return !!p.worker_topic;
}

export function isThrottled(p: QuorumProfile): boolean {
  return typeof p.throttle === 'number' && p.throttle !== 0;
}

export function formatThrottleHuman(ms?: number): string {
  if (ms === undefined || ms === 0) return 'Normal';
  if (ms === -1) return 'Paused';
  if (ms >= 86_400_000) return `${(ms / 86_400_000).toFixed(0)}d`;
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export function formatMemory(total?: string, free?: string): string {
  if (!total || !free) return '—';
  const t = parseFloat(total);
  const f = parseFloat(free);
  if (isNaN(t) || isNaN(f)) return '—';
  return `${(t - f).toFixed(1)} / ${t.toFixed(1)} GB`;
}

export function stripStreamPrefix(name: string): string {
  return name.replace(/^hmsh:[^:]+:x:/, '') || '(engine)';
}

/** Engine streams have no suffix after hmsh:{app}:x: */
export function isEngineStream(streamName: string): boolean {
  return stripStreamPrefix(streamName) === '(engine)';
}

export type NodeFilter = 'all' | 'workers' | 'engines';

/** Known quorum message types published via the bridge. */
export const QUORUM_CHANNELS = [
  { key: 'pong', label: 'Pong', description: 'Roll call responses' },
  { key: 'ping', label: 'Ping', description: 'Roll call broadcasts' },
  { key: 'throttle', label: 'Throttle', description: 'Throttle commands' },
  { key: 'job', label: 'Job', description: 'Job lifecycle events' },
  { key: 'work', label: 'Work', description: 'Worker dispatch events' },
  { key: 'activate', label: 'Activate', description: 'Worker activation' },
  { key: 'cron', label: 'Cron', description: 'Cron schedule triggers' },
  { key: 'user', label: 'User', description: 'User-defined messages' },
] as const;

/** Typed throttle target with display label and API params. */
export interface ThrottleTarget {
  label: string;
  /** API param: topic-based throttle (queues, all engines) */
  topic?: string;
  /** API param: guid-based throttle (single engine/worker) */
  guid?: string;
}

export const NODE_FILTER_OPTIONS = [
  { value: 'all', label: 'All Nodes' },
  { value: 'workers', label: 'Workers' },
  { value: 'engines', label: 'Engines' },
] as const;

export function rowKey(p: QuorumProfile): string {
  return `${p.engine_id}-${p.worker_topic || 'engine'}`;
}

// ── Queue-level helpers ────────────────────────────────────────────────

/** Group worker profiles by `worker_topic` (engines excluded). */
export function groupByQueue(profiles: QuorumProfile[]): Map<string, QuorumProfile[]> {
  const map = new Map<string, QuorumProfile[]>();
  for (const p of profiles) {
    if (!p.worker_topic) continue;
    const q = p.worker_topic;
    if (!map.has(q)) map.set(q, []);
    map.get(q)!.push(p);
  }
  return map;
}

/** Aggregate `counts` across profiles: 200 = success, 500 = error, all = total. */
export function sumCounts(profiles: QuorumProfile[]): { total: number; success: number; errors: number } {
  let total = 0;
  let success = 0;
  let errors = 0;
  for (const p of profiles) {
    if (!p.counts) continue;
    for (const [code, n] of Object.entries(p.counts)) {
      total += n;
      if (code === '200') success += n;
      else if (code === '500') errors += n;
    }
  }
  return { total, success, errors };
}

/** Sum `stream_depth` across profiles. */
export function totalPending(profiles: QuorumProfile[]): number {
  let sum = 0;
  for (const p of profiles) {
    if (typeof p.stream_depth === 'number') sum += p.stream_depth;
  }
  return sum;
}

/** Derive queue health from member profiles. */
export function queueHealth(profiles: QuorumProfile[]): 'healthy' | 'degraded' | 'paused' {
  if (profiles.length === 0) return 'healthy';
  const allPaused = profiles.every((p) => p.throttle === -1);
  if (allPaused) return 'paused';
  const { errors } = sumCounts(profiles);
  if (errors > 0 || profiles.some(isThrottled)) return 'degraded';
  return 'healthy';
}
