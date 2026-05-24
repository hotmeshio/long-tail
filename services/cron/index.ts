import { Virtual, Durable } from '@hotmeshio/hotmesh';
import { parseExpression } from 'cron-parser';

import { getConnection } from '../../lib/db';
import { JOB_EXPIRE_SECS } from '../../modules/defaults';
import { loggerRegistry } from '../../lib/logger';
import * as configService from '../config';
import { resolvePrincipal } from '../iam/principal';
import type { LTWorkflowConfig, LTAgent, AgentSchedule } from '../../types';
import type { LTYamlWorkflowRecord } from '../../types/yaml-workflow';
import type { LTEnvelopePrincipal } from '../../types/envelope';

const MIN_CRON_INTERVAL_MS = 60_000; // 1 minute minimum

/**
 * Validate a cron expression and enforce a minimum interval.
 * Throws if the expression is invalid or fires more often than once per minute.
 */
export function validateCronSchedule(expr: string): void {
  let interval;
  try {
    interval = parseExpression(expr, { utc: true });
  } catch {
    throw new Error(`Invalid cron expression: "${expr}"`);
  }
  const first = interval.next().toDate().getTime();
  const second = interval.next().toDate().getTime();
  const gap = second - first;
  if (gap < MIN_CRON_INTERVAL_MS) {
    throw new Error(
      `Cron interval too frequent: "${expr}" fires every ${Math.round(gap / 1000)}s (minimum is 60s)`,
    );
  }
}

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

    validateCronSchedule(config.cron_schedule);

    const connection = getConnection();
    const topic = `${CRON_TOPIC_PREFIX}.${config.workflow_type}`;
    const cronId = `${CRON_ID_PREFIX}-${config.workflow_type}`;

    const defaultEnvelope: Record<string, any> = config.envelope_schema
      ? { ...config.envelope_schema as Record<string, any> }
      : { data: {}, metadata: {} };

    // Ensure metadata.source identifies the cron
    if (!defaultEnvelope.metadata) defaultEnvelope.metadata = {};
    defaultEnvelope.metadata.source = 'cron';

    // Auto-certify if the workflow config has roles or consumes
    const isCertified = (config.roles?.length ?? 0) > 0 || (config.consumes?.length ?? 0) > 0;
    if (isCertified) {
      defaultEnvelope.metadata.certified = true;
    }

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
          const { guid } = Virtual.getContext();
          const workflowId = `${workflowType}-cron-${guid}`;
          loggerRegistry.info(`[lt-cron] invoking ${workflowType} (${workflowId})`);
          await client.workflow.start({
            args: [defaultEnvelope],
            taskQueue,
            workflowName: workflowType,
            workflowId,
            expire: JOB_EXPIRE_SECS,
            entity: workflowType,
            signalIn: false,
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

    validateCronSchedule(wf.cron_schedule);

    const connection = getConnection();
    const topic = `${YAML_CRON_TOPIC_PREFIX}.${wf.id}`;
    const cronId = `${YAML_CRON_ID_PREFIX}-${wf.id}`;

    const cronEnvelope = wf.cron_envelope || {};
    const wfId = wf.id;
    const graphTopic = wf.graph_topic;
    const appId = wf.app_id;
    let cronCallCount = 0;

    await Virtual.cron({
      topic,
      connection,
      callback: async () => {
        try {
          cronCallCount++;
          loggerRegistry.info(`[lt-cron] tick #${cronCallCount} at ${new Date().toISOString()} — pub(${appId}/${graphTopic})`);
          const { getEngine } = await import('../yaml-workflow/deployer');
          const engine = await getEngine(appId);
          await engine.pub(graphTopic, cronEnvelope, undefined, { entity: graphTopic });
          loggerRegistry.info(`[lt-cron] tick #${cronCallCount} published successfully`);
        } catch (err: any) {
          loggerRegistry.error(`[lt-cron] tick #${cronCallCount} failed: ${err?.message}`);
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

  // ── Agent schedule crons ──────────────────────────────────────────────

  /**
   * Start a single agent schedule cron.
   */
  async startAgentCron(
    agent: LTAgent,
    schedule: AgentSchedule,
    idx: number,
  ): Promise<void> {
    const key = `agent:${agent.id}-${idx}`;
    if (this.activeCrons.has(key)) return;

    validateCronSchedule(schedule.cron);

    const connection = getConnection();
    const topic = `lt.cron.agent.${agent.id}.${idx}`;
    const cronId = `lt-cron-agent-${agent.id}-${idx}`;

    const executeAs = schedule.execute_as || agent.user_id || undefined;
    const isPipeline = schedule.reaction_type === 'pipeline' && schedule.pipeline_id;

    // Resolve task queue at arm time (static — doesn't change between ticks)
    let taskQueue: string | undefined;
    if (!isPipeline) {
      const wfConfig = await configService.getWorkflowConfig(schedule.workflow_type!);
      taskQueue = wfConfig?.task_queue || schedule.workflow_type;
    }

    const targetLabel = isPipeline ? `pipeline:${schedule.pipeline_id}` : schedule.workflow_type;

    await Virtual.cron({
      topic,
      connection,
      callback: async () => {
        try {
          // Resolve principal at fire time so users seeded after startup are found
          let principal: LTEnvelopePrincipal | null | undefined;
          if (executeAs) {
            try { principal = await resolvePrincipal(executeAs); } catch { /* use system */ }
          }
          if (!principal) {
            principal = this.systemPrincipal ?? undefined;
          }
          loggerRegistry.info(`[lt-cron] agent ${agent.id} principal: ${principal?.id ?? 'NONE'} (executeAs=${executeAs ?? 'unset'})`);

          const envelope = {
            data: schedule.envelope ?? {},
            metadata: { source: 'agent-cron', agentId: agent.id, agentName: agent.id, certified: true },
            lt: {
              userId: principal?.id ?? 'lt-system',
              principal,
              scopes: ['workflow:invoke'],
            },
          };

          if (isPipeline) {
            const { invokeYamlWorkflow } = await import('../yaml-workflow/invoke');
            const { getYamlWorkflow } = await import('../yaml-workflow/db');
            const wf = await getYamlWorkflow(schedule.pipeline_id!);
            if (!wf) throw new Error(`Pipeline ${schedule.pipeline_id} not found`);
            loggerRegistry.info(`[lt-cron] agent invoking pipeline ${schedule.pipeline_id}`);
            await invokeYamlWorkflow(wf, {
              data: envelope.data ?? {},
              execute_as: executeAs,
            });
          } else {
            const client = new Durable.Client({ connection });
            const { guid } = Virtual.getContext();
            const workflowId = `agent-cron-${agent.id}-${idx}-${guid}`;
            loggerRegistry.info(`[lt-cron] agent invoking ${schedule.workflow_type} on ${taskQueue} (${workflowId})`);
            await client.workflow.start({
              args: [envelope],
              taskQueue,
              workflowName: schedule.workflow_type,
              workflowId,
              expire: JOB_EXPIRE_SECS,
              entity: schedule.workflow_type,
              signalIn: false,
            } as any);
          }
        } catch (err: any) {
          const msg = err?.message ?? '';
          if (msg.includes('Duplicate job')) {
            // Expected — deterministic ID dedup when cron fires multiple consumers
          } else {
            loggerRegistry.error(`[lt-cron] agent ${agent.id}/${targetLabel} failed: ${msg}`);
          }
        }
      },
      args: [],
      options: { id: cronId, interval: schedule.cron },
    });

    this.activeCrons.set(key, cronId);
    loggerRegistry.info(`[lt-cron] agent schedule started: ${agent.id}/${targetLabel} (${schedule.cron})`);
  }

  /**
   * Stop all cron schedules for an agent.
   */
  async stopAgentCrons(agentId: string): Promise<void> {
    const connection = getConnection();
    const toRemove: string[] = [];

    for (const [key, cronId] of this.activeCrons) {
      if (key.startsWith(`agent:${agentId}-`)) {
        const idx = key.split('-').pop();
        const topic = `lt.cron.agent.${agentId}.${idx}`;
        try {
          await Virtual.interrupt({ topic, connection, options: { id: cronId } });
        } catch { /* already stopped */ }
        toRemove.push(key);
      }
    }

    for (const key of toRemove) this.activeCrons.delete(key);
    if (toRemove.length) {
      loggerRegistry.info(`[lt-cron] stopped ${toRemove.length} agent schedule(s) for ${agentId}`);
    }
  }

  /**
   * Restart all cron schedules for an agent (after config change or pause/resume).
   */
  async restartAgentCrons(agent: LTAgent): Promise<void> {
    await this.stopAgentCrons(agent.id);

    if (agent.status !== 'active') return;

    const schedules = agent.behaviors?.schedules ?? [];
    for (let i = 0; i < schedules.length; i++) {
      const sched = schedules[i];
      if (sched.cron && (sched.workflow_type || sched.pipeline_id)) {
        await this.startAgentCron(agent, sched, i);
      }
    }
  }

  /**
   * Arm all cron schedules for active agents. Called at startup.
   */
  async connectAgentCrons(): Promise<void> {
    const { listAgents } = await import('../agent');
    const { agents } = await listAgents({ status: 'active', limit: 1000 });
    let armed = 0;

    for (const agent of agents) {
      const schedules = agent.behaviors?.schedules ?? [];
      for (let i = 0; i < schedules.length; i++) {
        const sched = schedules[i];
        if (sched.cron && (sched.workflow_type || sched.pipeline_id)) {
          try {
            await this.startAgentCron(agent, sched, i);
            armed++;
          } catch (err: any) {
            loggerRegistry.warn(`[lt-cron] agent schedule failed: ${agent.id}/${sched.cron}: ${err.message}`);
          }
        }
      }
    }

    loggerRegistry.info(`[lt-cron] ${armed} agent schedule(s) armed`);
  }

  /**
   * Disconnect on graceful shutdown. Clears the local registry so this
   * container stops consuming cron streams. Does NOT call Virtual.interrupt()
   * — cron jobs are durable rows shared across the fleet. Another container
   * (or this one on restart) will continue servicing them.
   *
   * Use stopCron/stopAgentCrons/stopYamlCron for intentional permanent kills
   * (e.g. user deletes an agent or changes a schedule via the dashboard).
   */
  async disconnect(): Promise<void> {
    this.activeCrons.clear();
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
