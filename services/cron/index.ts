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
import {
  legacyCronId,
  listWorkflowCrons,
  reconcileWorkflowCron,
  scheduledConfigFor,
  scheduleOf,
  type CronJobOps,
} from './workflow-schedule';
import { startScheduledRun } from './workflow-run';

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
const YAML_CRON_TOPIC_PREFIX = 'lt.cron.yaml';
const CRON_SOURCE = 'cron';
const YAML_CRON_ID_PREFIX = 'lt-cron-yaml';

/**
 * Singleton registry for workflow cron schedules.
 *
 * - connect(): arm every scheduled workflow at startup
 * - restartCron(): apply a saved or deleted config to its schedule
 * - disconnect(): stop consuming on shutdown; schedules keep running
 * - clear(): reset for tests
 *
 * Each workflow schedule runs as one HotMesh cron job, recorded in
 * lt_workflow_crons (see workflow-schedule.ts). Each tick reads the config as
 * stored now, so every container starts runs with the same settings.
 */
class LTCronRegistry {
  private activeCrons = new Map<string, string>(); // workflowType -> cronId
  private workerTopics = new Set<string>();
  private connected = false;
  private systemPrincipal: LTEnvelopePrincipal | null = null;

  private readonly jobOps: CronJobOps = {
    arm: (workflowType, jobId, schedule) => this.armJob(workflowType, jobId, schedule),
    interrupt: (workflowType, jobId) => this.interruptJob(workflowType, jobId),
  };

  /**
   * Arm every scheduled workflow. A workflow without a lt_workflow_crons row
   * runs under its original id, as before; arming a running job is a no-op.
   * Call after workers and migrations are ready.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    // Resolve the real system bot principal (ensured at startup)
    this.systemPrincipal = await resolvePrincipal('lt-system');

    const configs = await configService.listWorkflowConfigs();
    const crons = new Map((await listWorkflowCrons()).map((row) => [row.workflow_type, row]));
    const scheduled = configs.filter((c) => scheduleOf(c));

    for (const config of scheduled) {
      const type = config.workflow_type;
      if (!crons.has(type)) {
        await this.armJob(type, legacyCronId(type), config.cron_schedule!);
        continue;
      }
      const result = await reconcileWorkflowCron(type, this.jobOps, false);
      if (result.action === 'unchanged' && result.jobId) {
        await this.armJob(type, result.jobId, config.cron_schedule!);
      }
    }

    // Recorded schedules whose config no longer asks for one
    const scheduledTypes = new Set(scheduled.map((c) => c.workflow_type));
    for (const row of crons.values()) {
      if (row.schedule && !scheduledTypes.has(row.workflow_type)) {
        await reconcileWorkflowCron(row.workflow_type, this.jobOps, false);
      }
    }

    // Connect YAML workflow crons
    await this.connectYamlCrons();

    this.connected = true;
    if (scheduled.length > 0) {
      loggerRegistry.info(
        `[lt-cron] started ${scheduled.length} cron(s): ${scheduled.map((c) => c.workflow_type).join(', ')}`,
      );
    }
  }

  /**
   * Apply a workflow's stored config to its schedule after a save or delete.
   * An unchanged schedule keeps running; a changed one moves to a new job.
   */
  async restartCron(config: Pick<LTWorkflowConfig, 'workflow_type'>): Promise<void> {
    const type = config.workflow_type;
    const result = await reconcileWorkflowCron(type, this.jobOps, this.activeCrons.get(type) === legacyCronId(type));
    if (result.action === 'armed') {
      loggerRegistry.info(`[lt-cron] armed ${type} (${result.jobId})`);
    } else if (result.action === 'stopped') {
      this.activeCrons.delete(type);
      loggerRegistry.info(`[lt-cron] stopped ${type} (${result.jobId})`);
    }
  }

  /** Arm a cron job. The first job on a topic in this process also registers its worker. */
  private async armJob(workflowType: string, jobId: string, schedule: string): Promise<void> {
    validateCronSchedule(schedule);
    const topic = `${CRON_TOPIC_PREFIX}.${workflowType}`;
    const register = !this.workerTopics.has(topic);
    await Virtual.cron({
      topic,
      connection: getConnection(),
      ...(register ? { callback: () => this.runTick(workflowType) } : {}),
      args: [],
      options: { id: jobId, interval: schedule },
    });
    if (register) this.workerTopics.add(topic);
    this.activeCrons.set(workflowType, jobId);
  }

  private async interruptJob(workflowType: string, jobId: string): Promise<void> {
    try {
      await Virtual.interrupt({
        topic: `${CRON_TOPIC_PREFIX}.${workflowType}`,
        connection: getConnection(),
        options: { id: jobId },
      });
    } catch (err: any) {
      loggerRegistry.warn(`[lt-cron] interrupt failed for ${workflowType} (${jobId}): ${err?.message}`);
    }
  }

  /** One tick: start a run only when this job is the one the schedule runs under now. */
  private async runTick(workflowType: string): Promise<void> {
    const { workflowId: jobId, guid } = Virtual.getContext();
    try {
      const config = await scheduledConfigFor(workflowType, jobId);
      if (!config) {
        loggerRegistry.debug(`[lt-cron] ${workflowType} skipped tick of ${jobId}; not its current job`);
        return;
      }
      this.systemPrincipal ??= await resolvePrincipal('lt-system');
      await startScheduledRun(config, guid, this.systemPrincipal);
    } catch (err: any) {
      loggerRegistry.error(`[lt-cron] ${workflowType} failed: ${err?.message}`);
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
          // Through the invoke service, so the run carries only the scope the
          // server resolves for execute_as, never one written in the envelope.
          const { invokeYamlWorkflow } = await import('../yaml-workflow/invoke');
          await invokeYamlWorkflow(wf, { data: cronEnvelope, execute_as: wf.execute_as ?? undefined, source: CRON_SOURCE });
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
