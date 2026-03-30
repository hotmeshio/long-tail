import type { LTMaintenanceConfig } from '../types/maintenance';

/**
 * Default maintenance rules.
 *
 * Schedule: weekly on Sundays at 2 AM.
 *
 * Rules (executed sequentially):
 * 1. Delete stream messages older than 30 days
 * 2. Delete transient jobs (entity IS NULL) older than 30 days
 * 3. Strip execution artifacts from entity jobs older than 30 days
 *    (preserves jdata, udata, jmark, hmark — exports always work)
 * 4. Hard-delete pruned jobs older than 180 days
 *
 * Conservative defaults — execution artifacts (activity inputs, stream
 * history) are needed for rich export data. Pruning too early strips
 * inputs from the execution timeline.
 */
export const defaultMaintenanceConfig: LTMaintenanceConfig = {
  schedule: '0 2 * * 0',
  rules: [
    {
      target: 'streams',
      action: 'delete',
      olderThan: '30 days',
    },
    {
      target: 'jobs',
      action: 'delete',
      olderThan: '30 days',
      hasEntity: false,
    },
    {
      target: 'jobs',
      action: 'prune',
      olderThan: '30 days',
      hasEntity: true,
    },
    {
      target: 'jobs',
      action: 'delete',
      olderThan: '180 days',
      pruned: true,
    },
  ],
};
