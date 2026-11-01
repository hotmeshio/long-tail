import { loggerRegistry } from '../lib/logger';

/** Who owns declared configuration after first boot. */
export type ConfigSource = 'code' | 'db';

/**
 * Effective ownership for one declared entry: the per-entry `reset` flag wins
 * in either direction; otherwise the global `configSource` decides.
 */
export function ownedByCode(reset: boolean | undefined, source: ConfigSource): boolean {
  return reset ?? source === 'code';
}

/** Outcome of one entry's startup pass. */
export type ApplyOutcome = 'applied' | 'unchanged' | 'db-owned';

/** Per-surface tally of a boot's config pass. */
export interface SurfaceReport {
  applied: string[];
  unchanged: string[];
  dbOwned: string[];
  /** DB rows of this surface not declared in code (reported, never deleted). */
  orphans: string[];
}

export function newSurfaceReport(): SurfaceReport {
  return { applied: [], unchanged: [], dbOwned: [], orphans: [] };
}

/** Record one entry's outcome on the surface report. */
export function recordOutcome(report: SurfaceReport, name: string, outcome: ApplyOutcome): void {
  if (outcome === 'applied') report.applied.push(name);
  else if (outcome === 'unchanged') report.unchanged.push(name);
  else report.dbOwned.push(name);
}

export { withConfigLock } from '../lib/db/config-lock';

/**
 * One boot line per surface. Warn level when orphans exist so operators see
 * "declared set no longer matches the DB" without grepping.
 */
export function logSurfaceReport(surface: string, report: SurfaceReport): void {
  const counts =
    `applied ${report.applied.length}, unchanged ${report.unchanged.length}, ` +
    `db-owned ${report.dbOwned.length}`;
  if (report.orphans.length > 0) {
    loggerRegistry.warn(
      `[long-tail] config apply (${surface}): ${counts}, orphans: [${report.orphans.join(', ')}]`,
    );
  } else {
    loggerRegistry.info(`[long-tail] config apply (${surface}): ${counts}`);
  }
}
