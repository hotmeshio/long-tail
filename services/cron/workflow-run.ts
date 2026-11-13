import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../lib/db';
import { JOB_EXPIRE_SECS } from '../../modules/defaults';
import { loggerRegistry } from '../../lib/logger';
import { startProviderWorkflow } from '../durable-provider';
import { runsOnHotMesh } from '../workflow-invocation';
import { resolvePrincipal } from '../iam/principal';
import type { LTWorkflowConfig } from '../../types';
import type { LTEnvelopePrincipal } from '../../types/envelope';

const CRON_SOURCE = 'cron';

/** The envelope a scheduled run starts with, from the config as stored now. */
export async function buildCronEnvelope(
  config: LTWorkflowConfig,
  systemPrincipal: LTEnvelopePrincipal | null,
): Promise<Record<string, any>> {
  const envelope: Record<string, any> = config.envelope_schema
    ? { ...config.envelope_schema as Record<string, any> }
    : { data: {}, metadata: {} };

  envelope.metadata = { ...envelope.metadata, source: CRON_SOURCE };
  if ((config.roles?.length ?? 0) > 0 || (config.consumes?.length ?? 0) > 0) {
    envelope.metadata.certified = true;
  }

  // Executing principal: per-config execute_as, or the system bot
  envelope.lt = { ...envelope.lt };
  if (!envelope.lt.principal) {
    let principal = systemPrincipal;
    if (config.execute_as) {
      const bot = await resolvePrincipal(config.execute_as);
      if (bot) principal = bot;
    }
    if (principal) {
      envelope.lt.userId = principal.id;
      envelope.lt.principal = principal;
    }
    envelope.lt.scopes = ['workflow:cron'];
  }
  return envelope;
}

/** Start one scheduled run, on the provider or on HotMesh. `guid` is the tick's, so a retried tick reuses the id. */
export async function startScheduledRun(
  config: LTWorkflowConfig,
  guid: string,
  systemPrincipal: LTEnvelopePrincipal | null,
): Promise<void> {
  const workflowType = config.workflow_type;
  const taskQueue = config.task_queue!;
  const workflowId = `${workflowType}-cron-${guid}`;
  const envelope = await buildCronEnvelope(config, systemPrincipal);
  loggerRegistry.info(`[lt-cron] invoking ${workflowType} (${workflowId})`);
  if (!runsOnHotMesh(workflowType)) {
    await startProviderWorkflow({ workflowType, workflowId, taskQueue, envelope });
    return;
  }
  const client = new Durable.Client({ connection: getConnection() });
  await client.workflow.start({
    args: [envelope],
    taskQueue,
    workflowName: workflowType,
    workflowId,
    expire: JOB_EXPIRE_SECS,
    entity: workflowType,
    signalIn: false,
  } as any);
}
