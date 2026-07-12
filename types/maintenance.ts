/**
 * A single maintenance rule describing what to prune and when.
 */
export interface LTMaintenanceRule {
  /** Which resource to target */
  target: 'streams' | 'jobs' | 'escalations';
  /** delete = hard-delete rows; prune = strip execution artifacts */
  action: 'delete' | 'prune';
  /** Postgres interval for the retention window, e.g. '7 days', '90 days' */
  olderThan: string;
  /** When target is 'jobs': true = entity jobs, false = transient (entity IS NULL) */
  hasEntity?: boolean;
  /** When true, only target jobs that have already been pruned (pruned_at IS NOT NULL) */
  pruned?: boolean;
  /**
   * When target is 'escalations': which terminal statuses to age out.
   * Defaults to all three. Pending rows and live waiters are never touched.
   */
  statuses?: Array<'resolved' | 'cancelled' | 'expired'>;
}

/**
 * Full maintenance configuration: schedule + ordered rules.
 */
export interface LTMaintenanceConfig {
  /** HotMesh application namespace to prune */
  appId: string;
  /** Cron expression or ms-compatible interval, e.g. '0 2 * * *' or '1 day' */
  schedule: string;
  /** Rules executed sequentially each cycle */
  rules: LTMaintenanceRule[];
}
