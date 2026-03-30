import { HotMesh } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type { HotMeshManifest } from '@hotmeshio/hotmesh/build/types/hotmesh';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

import { postgres_options } from '../../modules/config';
import { YAML_LINE_WIDTH, WORKFLOW_SYNC_TIMEOUT_MS } from '../../modules/defaults';
import { loggerRegistry } from '../logger';
import * as namespaceService from '../namespace';
import * as yamlDb from './db';

/** Cache of HotMesh engine instances keyed by appId */
const engines = new Map<string, HotMesh>();

/**
 * Get or create a HotMesh engine instance for a given app ID.
 * Flows sharing the same appId share the same engine (and DB connection pool).
 */
export async function getEngine(appId: string): Promise<HotMesh> {
  const cached = engines.get(appId);
  if (cached) return cached;

  const engine = await HotMesh.init({
    appId,
    engine: {
      connection: { class: Postgres, options: postgres_options },
    },
  });
  engines.set(appId, engine);
  return engine;
}

/**
 * Merge all YAML graphs for an app_id into a single YAML document.
 * HotMesh supports multiple graphs in one app definition under `app.graphs[]`.
 */
export async function buildMergedYaml(appId: string, version: string): Promise<string> {
  const workflows = await yamlDb.listYamlWorkflowsByAppId(appId);
  if (workflows.length === 0) {
    throw new Error(`No YAML workflows found for app_id: ${appId}`);
  }

  const allGraphs: unknown[] = [];
  for (const wf of workflows) {
    const parsed = yaml.load(wf.yaml_content) as { app?: { graphs?: unknown[] } };
    if (parsed?.app?.graphs) {
      allGraphs.push(...parsed.app.graphs);
    }
  }

  // Pre-validate: check for duplicate activity IDs across all graphs
  const activityIds = new Map<string, string>(); // id → graph subscribes topic
  const duplicates: string[] = [];
  for (const graph of allGraphs) {
    const g = graph as { subscribes?: string; activities?: Record<string, unknown> };
    const topic = g.subscribes || 'unknown';
    if (g.activities) {
      for (const id of Object.keys(g.activities)) {
        if (activityIds.has(id)) {
          duplicates.push(`"${id}" in both "${activityIds.get(id)}" and "${topic}"`);
        } else {
          activityIds.set(id, topic);
        }
      }
    }
  }
  if (duplicates.length > 0) {
    const msg = `Duplicate activity IDs across graphs in app "${appId}": ${duplicates.join('; ')}`;
    loggerRegistry.error(`[yaml-workflow] ${msg}`);
    throw new Error(msg);
  }

  const merged = {
    app: {
      id: appId,
      version,
      graphs: allGraphs,
    },
  };

  return yaml.dump(merged, { lineWidth: YAML_LINE_WIDTH, noRefs: true, sortKeys: false });
}

/**
 * Deploy all YAML workflows for an app_id as a single merged version.
 *
 * On failure, attempts one recompilation cycle:
 *   1. Identifies the workflow that was most recently compiled (the trigger)
 *   2. Re-runs the full compilation pipeline with the error as context
 *   3. The compile stage's LLM receives the error + failed YAML to avoid the same issue
 *   4. Stores the recompiled YAML and retries deployment
 *
 * If recompilation is unavailable or fails, the original error is thrown.
 */
export async function deployAppId(
  appId: string,
  version: string,
): Promise<HotMeshManifest> {
  await namespaceService.registerNamespace(appId);

  const mergedYaml = await buildMergedYaml(appId, version);
  loggerRegistry.debug(`[yaml-workflow] merged YAML for ${appId} v${version}:\n${mergedYaml}`);

  const engine = await getEngine(appId);
  try {
    const manifest = await engine.deploy(mergedYaml);
    await engine.activate(version);
    loggerRegistry.info(`[yaml-workflow] deployed+activated ${appId} v${version} (merged)`);
    return manifest;
  } catch (err: any) {
    loggerRegistry.error(
      `[yaml-workflow] deployment failed for ${appId} v${version}: ${err.message}`,
    );

    // Attempt recompilation with error context
    const recompiled = await recompileWithContext(appId, mergedYaml, err.message);
    if (!recompiled) throw err;

    // Rebuild merged YAML with the recompiled workflow and retry
    loggerRegistry.info(`[yaml-workflow] retrying deployment after recompilation for ${appId}`);
    try {
      const retriedYaml = await buildMergedYaml(appId, version);
      const manifest = await engine.deploy(retriedYaml);
      await engine.activate(version);
      loggerRegistry.info(`[yaml-workflow] recompilation succeeded — deployed+activated ${appId} v${version}`);
      return manifest;
    } catch (retryErr: any) {
      loggerRegistry.error(
        `[yaml-workflow] recompilation retry also failed for ${appId}: ${retryErr.message}`,
      );
      throw retryErr;
    }
  }
}

/**
 * Re-run the compilation pipeline for the most recently compiled workflow
 * in the app, feeding the deployment error as context so the LLM can
 * produce a plan that avoids the same issue.
 *
 * Returns true if recompilation succeeded and the DB was updated, false otherwise.
 */
async function recompileWithContext(
  appId: string,
  failedYaml: string,
  errorMessage: string,
): Promise<boolean> {
  try {
    // Find the most recently updated non-archived workflow for this app_id
    const workflows = await yamlDb.listYamlWorkflowsByAppId(appId);
    // Sort by updated_at desc to find the one that likely triggered the failure
    const sorted = workflows.sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
    const target = sorted[0];
    if (!target?.source_workflow_id) {
      loggerRegistry.warn('[yaml-workflow] recompilation skipped: no source workflow to recompile from');
      return false;
    }

    loggerRegistry.info(
      `[yaml-workflow] recompiling "${target.name}" (source: ${target.source_workflow_id}) with error context`,
    );

    const { generateYamlFromExecution } = await import('./generator');
    const result = await generateYamlFromExecution({
      workflowId: target.source_workflow_id,
      taskQueue: 'long-tail-system',
      workflowName: 'mcpQuery',
      name: target.name,
      description: target.description || undefined,
      appId: target.app_id,
      subscribes: target.graph_topic,
      priorDeployError: errorMessage,
      priorFailedYaml: failedYaml,
    });

    // Update the workflow record with the recompiled YAML
    await yamlDb.updateYamlWorkflow(target.id, {
      yaml_content: result.yaml,
      activity_manifest: result.activityManifest,
    });
    loggerRegistry.info(
      `[yaml-workflow] recompilation complete for "${target.name}" (${result.yaml.length} chars)`,
    );
    return true;
  } catch (err: any) {
    loggerRegistry.warn(`[yaml-workflow] recompilation failed: ${err.message}`);
    return false;
  }
}

/**
 * Deploy a single YAML workflow to HotMesh (inactive until activated).
 * @deprecated Use deployAppId for merged deployment.
 */
export async function deployYamlWorkflow(
  appId: string,
  yamlContent: string,
): Promise<HotMeshManifest> {
  const engine = await getEngine(appId);
  const manifest = await engine.deploy(yamlContent);
  loggerRegistry.info(`[yaml-workflow] deployed ${appId}`);
  return manifest;
}

/**
 * Activate a deployed version of a YAML workflow.
 */
export async function activateYamlWorkflow(
  appId: string,
  version: string,
): Promise<boolean> {
  const engine = await getEngine(appId);
  const result = await engine.activate(version);
  loggerRegistry.info(`[yaml-workflow] activated ${appId} v${version}`);
  return result;
}

/**
 * Invoke a YAML workflow (fire-and-forget). Returns the job ID.
 */
export async function invokeYamlWorkflow(
  appId: string,
  topic: string,
  data: Record<string, unknown>,
  entity?: string,
): Promise<string> {
  const engine = await getEngine(appId);
  return engine.pub(topic, data, undefined, entity ? { entity } : undefined);
}

/**
 * Invoke a YAML workflow and wait for the result.
 *
 * Replicates HotMesh's engine.pubsub() logic exactly, but adds the
 * `extended` parameter (where entity lives) to the internal pub() call.
 * HotMesh's pubsub omits extended, so entity was never set.
 *
 * Source: @hotmeshio/hotmesh engine/index.js pubsub()
 */
export async function invokeYamlWorkflowSync(
  appId: string,
  topic: string,
  data: Record<string, unknown>,
  timeout?: number,
  entity?: string,
): Promise<{ job_id: string; result: Record<string, unknown> }> {
  const hotmesh = await getEngine(appId);
  const engine = (hotmesh as any).engine;
  const timeoutMs = timeout ?? WORKFLOW_SYNC_TIMEOUT_MS;

  // Build context with engine GUID for one-time subscription routing
  // (exactly as engine.pubsub does)
  const context = {
    metadata: {
      ngn: engine.guid,
    },
  };

  // Publish with entity via extended param
  const extended = entity ? { entity } : undefined;
  const jobId: string = await engine.pub(topic, data, context, extended);

  return new Promise((resolve, reject) => {
    engine.registerJobCallback(jobId, (_topic: string, output: any) => {
      if (output.metadata.err) {
        const error = JSON.parse(output.metadata.err);
        reject({ error, job_id: output.metadata.jid });
      } else {
        resolve({
          job_id: jobId,
          result: output as unknown as Record<string, unknown>,
        });
      }
    });
    setTimeout(() => {
      engine.delistJobCallback(jobId);
      reject({ code: 598, message: 'timeout', job_id: jobId });
    }, timeoutMs);
  });
}

/**
 * Stop a specific YAML workflow engine.
 */
export async function stopEngine(appId: string): Promise<void> {
  const engine = engines.get(appId);
  if (engine) {
    await engine.stop();
    engines.delete(appId);
  }
}

/**
 * Stop all YAML workflow engines.
 */
export async function stopAllEngines(): Promise<void> {
  for (const [appId, engine] of engines) {
    await engine.stop();
    engines.delete(appId);
  }
}
