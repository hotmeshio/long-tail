import { formatDistanceToNowStrict, format } from 'date-fns';

/** Locale-formatted integer with commas: 1234567 → "1,234,567" */
export function formatCount(n: number): string {
  return n.toLocaleString();
}

/** Compact count for tight spaces: <1K plain, ≥1K → "1.2K", ≥1M → "1.2M", ≥1B → "1.2B" */
export function formatCountCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

/**
 * Format an ISO date string as a relative time ago (e.g., "30s ago", "5m ago").
 */
export function formatTimeAgo(dateStr: string): string {
  const then = new Date(dateStr);
  if (then.getTime() > Date.now()) return 'just now';
  return formatDistanceToNowStrict(then, { addSuffix: true });
}

/**
 * Compact single-unit "ago" for dense tables: "12m", "3h", "2d", "4w", "5mo", "1y".
 */
export function formatAgoCompact(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 30) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/**
 * Format remaining time as a compact human-readable string.
 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Expired';
  return formatDurationCompact(ms);
}

/**
 * Format a duration in milliseconds as a compact human-readable string.
 * Uses the two most significant units: "2d 5h", "3h 12m", "5m 30s", "1.2s", "50ms".
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '--';
  return formatDurationCompact(ms);
}

/**
 * Format an ISO date string as a locale-aware date/time.
 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '--';
  return format(new Date(iso), 'MMM d, yyyy h:mm a');
}

/**
 * Format a duration in milliseconds as a compact multi-tier string.
 *
 * Picks the two most significant non-zero units:
 *   0–999ms       → "50ms"
 *   1s–59s        → "1.2s"
 *   1m–59m        → "5m 30s"
 *   1h–23h        → "3h 12m"
 *   1d+           → "2d 5h"
 */
export function formatDurationCompact(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const secs = ms / 1000;
    return Number.isInteger(secs) ? `${secs}s` : `${secs.toFixed(1)}s`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * Format a duration between two ISO timestamps as a compact string.
 * If endIso is null/undefined, uses the current time (for running durations).
 */
export function formatElapsed(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return formatDurationCompact(end - start);
}
