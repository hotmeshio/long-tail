import type { LTMaintenanceConfig } from '../types/maintenance';

/**
 * Default maintenance rules.
 *
 * Schedule: nightly at 2 AM.
 *
 * Rules (executed sequentially):
 * 1. Delete stream messages older than 7 days
 * 2. Delete transient jobs (entity IS NULL) older than 7 days
 * 3. Strip execution artifacts from entity jobs older than 7 days
 *    (preserves jdata, udata, jmark, hmark — exports always work)
 * 4. Hard-delete all expired jobs older than 90 days
 */
export const defaultMaintenanceConfig: LTMaintenanceConfig = {
  schedule: '0 2 * * *',
  rules: [
    {
      target: 'streams',
      action: 'delete',
      olderThan: '7 days',
    },
    {
      target: 'jobs',
      action: 'delete',
      olderThan: '7 days',
      hasEntity: false,
    },
    {
      target: 'jobs',
      action: 'prune',
      olderThan: '7 days',
      hasEntity: true,
    },
    {
      target: 'jobs',
      action: 'delete',
      olderThan: '90 days',
      pruned: true,
    },
  ],
};
