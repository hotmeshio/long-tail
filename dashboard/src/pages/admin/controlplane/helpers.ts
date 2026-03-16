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

export const MAX_EVENTS = 200;

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
