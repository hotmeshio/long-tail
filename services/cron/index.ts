import { Virtual, Durable } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';

import { postgres_options } from '../../modules/config';
import { JOB_EXPIRE_SECS } from '../../modules/defaults';
import { loggerRegistry } from '../logger';
import * as configService from '../config';
import type { LTWorkflowConfig } from '../../types';

const CRON_TOPIC_PREFIX = 'lt.cron';
const CRON_ID_PREFIX = 'lt-cron';

/**
 * Singleton registry for workflow cron schedules.
 *
 * Follows the same pattern as maintenanceRegistry:
 * - connect()   — load configs with cron_schedule, start Virtual.cron for each
 * - disconnect() — interrupt all crons
 * - restartCron() — stop + start a single cron after config change
 * - clear()     — reset for tests
 */
class LTCronRegistry {
  private activeCrons = new Map<string, string>(); // workflowType -> cronId
  private connected = false;

  /**
   * Load all workflow configs with a cron_schedule and start Virtual.cron for each.
   * Call after workers and migrations are ready.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    const configs = await configService.listWorkflowConfigs();
    const cronConfigs = configs.filter(
      (c) => c.cron_schedule && c.invocable && c.task_queue,
    );

    for (const config of cronConfigs) {
      await this.startCron(config);
    }

    this.connected = true;
    if (cronConfigs.length > 0) {
      loggerRegistry.info(
        `[lt-cron] started ${cronConfigs.length} cron(s): ${cronConfigs.map((c) => c.workflow_type).join(', ')}`,
      );
    }
  }

  /**
   * Start a single Virtual.cron for a workflow config.
   */
  async startCron(config: LTWorkflowConfig): Promise<void> {
    if (!config.cron_schedule || !config.task_queue) return;

    const connection = { class: Postgres, options: postgres_options };
    const topic = `${CRON_TOPIC_PREFIX}.${config.workflow_type}`;
    const cronId = `${CRON_ID_PREFIX}-${config.workflow_type}`;

    const defaultEnvelope: Record<string, any> = config.envelope_schema
      ? { ...config.envelope_schema as Record<string, any> }
      : { data: {}, metadata: {} };

    // Ensure metadata.source identifies the cron
    if (!defaultEnvelope.metadata) defaultEnvelope.metadata = {};
    defaultEnvelope.metadata.source = 'cron';

    const workflowType = config.workflow_type;
    const taskQueue = config.task_queue;

    await Virtual.cron({
      topic,
      connection,
      callback: async () => {
        try {
          const client = new Durable.Client({ connection });
          const workflowId = `${workflowType}-cron-${Durable.guid()}`;
          loggerRegistry.info(`[lt-cron] invoking ${workflowType} (${workflowId})`);
          await client.workflow.start({
            args: [defaultEnvelope],
            taskQueue,
            workflowName: workflowType,
            workflowId,
            expire: JOB_EXPIRE_SECS,
            entity: workflowType,
          } as any);
        } catch (err: any) {
          loggerRegistry.error(`[lt-cron] ${workflowType} failed: ${err?.message}`);
        }
      },
      args: [],
      options: {
        id: cronId,
        interval: config.cron_schedule,
      },
    });

    this.activeCrons.set(config.workflow_type, cronId);
  }

  /**
   * Stop a single cron for a workflow type.
   */
  async stopCron(workflowType: string): Promise<void> {
    const cronId = this.activeCrons.get(workflowType);
    if (!cronId) return;

    const connection = { class: Postgres, options: postgres_options };
    const topic = `${CRON_TOPIC_PREFIX}.${workflowType}`;

    try {
      await Virtual.interrupt({
        topic,
        connection,
        options: { id: cronId },
      });
    } catch (err: any) {
      loggerRegistry.warn(
        `[lt-cron] interrupt failed for ${workflowType}: ${err?.message}`,
      );
    }

    this.activeCrons.delete(workflowType);
  }

  /**
   * Restart a cron after a config change.
   * Stops the old cron (if any) and starts a new one if cron_schedule is set.
   */
  async restartCron(config: LTWorkflowConfig): Promise<void> {
    await this.stopCron(config.workflow_type);
    if (config.cron_schedule && config.invocable && config.task_queue) {
      await this.startCron(config);
      loggerRegistry.info(
        `[lt-cron] restarted ${config.workflow_type} (${config.cron_schedule})`,
      );
    }
  }

  /**
   * Stop all active crons. Call during graceful shutdown.
   */
  async disconnect(): Promise<void> {
    for (const workflowType of [...this.activeCrons.keys()]) {
      await this.stopCron(workflowType);
    }
    this.connected = false;
  }

  /**
   * Reset state. Used in tests.
   */
  clear(): void {
    this.activeCrons.clear();
    this.connected = false;
  }

  get hasActiveCrons(): boolean {
    return this.activeCrons.size > 0;
  }

  get activeWorkflowTypes(): string[] {
    return [...this.activeCrons.keys()];
  }
}

/** Singleton cron registry */
export const cronRegistry = new LTCronRegistry();
