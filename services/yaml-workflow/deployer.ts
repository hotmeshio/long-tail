import { HotMesh } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type { HotMeshManifest } from '@hotmeshio/hotmesh/build/types/hotmesh';

import { postgres_options } from '../../modules/config';
import { WORKFLOW_SYNC_TIMEOUT_MS } from '../../modules/defaults';
import { loggerRegistry } from '../logger';
import * as namespaceService from '../namespace';
import { buildMergedYaml, recompileWithContext } from './deployer-helpers';

// Re-export helpers so existing `import * from './deployer'` consumers keep working
export { buildMergedYaml } from './deployer-helpers';

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
