import { Virtual, Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../lib/db';
import { JOB_EXPIRE_SECS } from '../../modules/defaults';
import { loggerRegistry } from '../../lib/logger';
import * as configService from '../config';
import { resolvePrincipal } from '../iam/principal';
import type { LTWorkflowConfig } from '../../types';
import type { LTYamlWorkflowRecord } from '../../types/yaml-workflow';
import type { LTEnvelopePrincipal } from '../../types/envelope';

const CRON_TOPIC_PREFIX = 'lt.cron';
const CRON_ID_PREFIX = 'lt-cron';
const YAML_CRON_TOPIC_PREFIX = 'lt.cron.yaml';
const YAML_CRON_ID_PREFIX = 'lt-cron-yaml';

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
  private systemPrincipal: LTEnvelopePrincipal | null = null;

  /**
   * Load all workflow configs with a cron_schedule and start Virtual.cron for each.
   * Call after workers and migrations are ready.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    // Resolve the real system bot principal (ensured at startup)
    this.systemPrincipal = await resolvePrincipal('lt-system');

    const configs = await configService.listWorkflowConfigs();
    const cronConfigs = configs.filter(
      (c) => c.cron_schedule && c.invocable && c.task_queue,
    );

    for (const config of cronConfigs) {
      await this.startCron(config);
    }

    // Connect YAML workflow crons
    await this.connectYamlCrons();

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

    const connection = getConnection();
    const topic = `${CRON_TOPIC_PREFIX}.${config.workflow_type}`;
    const cronId = `${CRON_ID_PREFIX}-${config.workflow_type}`;

    const defaultEnvelope: Record<string, any> = config.envelope_schema
      ? { ...config.envelope_schema as Record<string, any> }
      : { data: {}, metadata: {} };

    // Ensure metadata.source identifies the cron
    if (!defaultEnvelope.metadata) defaultEnvelope.metadata = {};
    defaultEnvelope.metadata.source = 'cron';

    // Resolve executing principal: per-config execute_as, or system bot fallback
    if (!defaultEnvelope.lt) defaultEnvelope.lt = {};
    if (!defaultEnvelope.lt.principal) {
      let cronPrincipal = this.systemPrincipal;
      if (config.execute_as) {
        const botPrincipal = await resolvePrincipal(config.execute_as);
        if (botPrincipal) cronPrincipal = botPrincipal;
      }
      if (cronPrincipal) {
        defaultEnvelope.lt.userId = cronPrincipal.id;
        defaultEnvelope.lt.principal = cronPrincipal;
      }
      defaultEnvelope.lt.scopes = ['workflow:cron'];
    }

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

    const connection = getConnection();
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

  // ── YAML workflow crons ────────────────────────────────────────────────────

  /**
   * Load all YAML workflows with a cron_schedule and start Virtual.cron for each.
   */
  async connectYamlCrons(): Promise<void> {
    const { getCronScheduledWorkflows } = await import('../yaml-workflow/db');
    const yamlWfs = await getCronScheduledWorkflows();

    for (const wf of yamlWfs) {
      await this.startYamlCron(wf);
    }

    if (yamlWfs.length > 0) {
      loggerRegistry.info(
        `[lt-cron] started ${yamlWfs.length} YAML cron(s): ${yamlWfs.map((w) => w.graph_topic).join(', ')}`,
      );
    }
  }

  /**
   * Start a single Virtual.cron for a YAML workflow.
   */
  async startYamlCron(wf: LTYamlWorkflowRecord): Promise<void> {
    if (!wf.cron_schedule) return;

    const connection = getConnection();
    const topic = `${YAML_CRON_TOPIC_PREFIX}.${wf.id}`;
    const cronId = `${YAML_CRON_ID_PREFIX}-${wf.id}`;

    const cronEnvelope = wf.cron_envelope || {};
    const executeAs = wf.execute_as;
    const wfId = wf.id;
    let inFlight = false;

    await Virtual.cron({
      topic,
      connection,
      callback: async () => {
        if (inFlight) {
          loggerRegistry.warn(`[lt-cron] YAML workflow ${wfId} still in-flight, skipping tick`);
          return;
        }
        inFlight = true;
        try {
          const { invokeYamlWorkflow } = await import('../yaml-workflow/invoke');
          const { getYamlWorkflow } = await import('../yaml-workflow/db');
          const current = await getYamlWorkflow(wfId);
          if (!current || current.status !== 'active') {
            loggerRegistry.warn(`[lt-cron] YAML workflow ${wfId} no longer active, skipping`);
            return;
          }
          loggerRegistry.info(`[lt-cron] invoking YAML workflow ${current.graph_topic} (${wfId})`);
          await invokeYamlWorkflow(current, {
            data: cronEnvelope as Record<string, unknown>,
            execute_as: executeAs || undefined,
            source: 'cron',
          });
          loggerRegistry.info(`[lt-cron] YAML workflow ${current.graph_topic} completed`);
        } catch (err: any) {
          loggerRegistry.error(`[lt-cron] YAML workflow ${wfId} failed: ${err?.message}`);
        } finally {
          inFlight = false;
        }
      },
      args: [],
      options: {
        id: cronId,
        interval: wf.cron_schedule,
      },
    });

    this.activeCrons.set(`yaml:${wf.id}`, cronId);
  }

  /**
   * Stop a single YAML workflow cron.
   */
  async stopYamlCron(yamlWfId: string): Promise<void> {
    const key = `yaml:${yamlWfId}`;
    const cronId = this.activeCrons.get(key);
    if (!cronId) return;

    const connection = getConnection();
    const topic = `${YAML_CRON_TOPIC_PREFIX}.${yamlWfId}`;

    try {
      await Virtual.interrupt({
        topic,
        connection,
        options: { id: cronId },
      });
    } catch (err: any) {
      loggerRegistry.warn(
        `[lt-cron] interrupt failed for YAML workflow ${yamlWfId}: ${err?.message}`,
      );
    }

    this.activeCrons.delete(key);
  }

  /**
   * Restart a YAML workflow cron after config change.
   */
  async restartYamlCron(wf: LTYamlWorkflowRecord): Promise<void> {
    await this.stopYamlCron(wf.id);
    if (wf.cron_schedule && wf.status === 'active') {
      await this.startYamlCron(wf);
      loggerRegistry.info(
        `[lt-cron] restarted YAML cron ${wf.graph_topic} (${wf.cron_schedule})`,
      );
    }
  }

  /**
   * Stop all active crons. Call during graceful shutdown.
   */
  async disconnect(): Promise<void> {
    for (const workflowType of [...this.activeCrons.keys()]) {
      if (workflowType.startsWith('yaml:')) {
        await this.stopYamlCron(workflowType.replace('yaml:', ''));
      } else {
        await this.stopCron(workflowType);
      }
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
