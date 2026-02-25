import { Virtual } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';

import { postgres_options } from '../../modules/config';
import * as dbaService from '../dba';
import type { LTMaintenanceConfig, LTMaintenanceRule } from '../../types/maintenance';

const CRON_TOPIC = 'lt.maintenance.prune';
const CRON_ID = 'lt-maintenance-nightly';

/**
 * Translate a single maintenance rule into the appropriate dbaService.prune() call.
 */
async function executeRule(rule: LTMaintenanceRule): Promise<void> {
  switch (true) {
    // Delete stream messages
    case rule.target === 'streams' && rule.action === 'delete':
      await dbaService.prune({
        expire: rule.olderThan,
        streams: true,
        jobs: false,
      });
      break;

    // Delete transient jobs (entity IS NULL)
    case rule.target === 'jobs' && rule.action === 'delete' && rule.hasEntity === false:
      await dbaService.prune({
        expire: rule.olderThan,
        jobs: false,
        streams: false,
        pruneTransient: true,
      });
      break;

    // Strip execution artifacts from entity jobs (keep jdata/udata/jmark/hmark)
    case rule.target === 'jobs' && rule.action === 'prune' && rule.hasEntity === true:
      await dbaService.prune({
        expire: rule.olderThan,
        jobs: false,
        streams: false,
        attributes: true,
        keepHmark: true,
      });
      break;

    // Hard-delete old pruned jobs
    case rule.target === 'jobs' && rule.action === 'delete' && rule.pruned === true:
      await dbaService.prune({
        expire: rule.olderThan,
        jobs: true,
        streams: false,
      });
      break;

    default:
      console.warn('[lt-maintenance] unknown rule, skipping:', rule);
  }
}

/**
 * Singleton registry for automatic database maintenance.
 *
 * Follows the same pattern as telemetryRegistry and eventRegistry:
 * - register(config) — set the maintenance schedule and rules
 * - connect()        — start the Virtual.cron
 * - disconnect()     — interrupt the cron
 * - clear()          — reset (for tests)
 */
class LTMaintenanceRegistry {
  private _config: LTMaintenanceConfig | null = null;
  private connected = false;

  /**
   * Register a maintenance configuration. Call before connect().
   * Replaces any previously registered config.
   */
  register(config: LTMaintenanceConfig): void {
    this._config = config;
  }

  /**
   * Start the maintenance cron using Virtual.cron().
   * Idempotent — given the same CRON_ID, restarts won't duplicate.
   */
  async connect(): Promise<void> {
    if (this.connected || !this._config) return;

    const rules = this._config.rules;
    const schedule = this._config.schedule;
    const connection = { class: Postgres, options: postgres_options };

    await Virtual.cron({
      topic: CRON_TOPIC,
      connection,
      callback: async () => {
        console.log('[lt-maintenance] starting maintenance cycle...');
        for (const rule of rules) {
          try {
            await executeRule(rule);
          } catch (err: any) {
            console.error('[lt-maintenance] rule failed:', rule, err?.message);
          }
        }
        console.log('[lt-maintenance] maintenance cycle complete.');
      },
      args: [],
      options: {
        id: CRON_ID,
        interval: schedule,
      },
    });

    this.connected = true;
    console.log(`[lt-maintenance] cron started (schedule: ${schedule})`);
  }

  /**
   * Interrupt the running cron. Call during graceful shutdown.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      const connection = { class: Postgres, options: postgres_options };
      await Virtual.interrupt({
        topic: CRON_TOPIC,
        connection,
        options: { id: CRON_ID },
      });
    } catch (err: any) {
      console.warn('[lt-maintenance] interrupt failed (may not be running):', err?.message);
    }

    this.connected = false;
  }

  /**
   * Remove config and reset state. Used in tests.
   */
  clear(): void {
    this._config = null;
    this.connected = false;
  }

  /**
   * Check if a config is registered.
   */
  get hasConfig(): boolean {
    return this._config !== null;
  }

  /**
   * Get the current config.
   */
  get config(): LTMaintenanceConfig | null {
    return this._config;
  }
}

/** Singleton maintenance registry */
export const maintenanceRegistry = new LTMaintenanceRegistry();
