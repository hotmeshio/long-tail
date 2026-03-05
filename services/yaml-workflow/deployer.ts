import { HotMesh } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type { HotMeshManifest } from '@hotmeshio/hotmesh/build/types/hotmesh';

import { postgres_options } from '../../modules/config';
import { loggerRegistry } from '../logger';

/** Cache of HotMesh engine instances keyed by appId */
const engines = new Map<string, HotMesh>();

/**
 * Get or create a HotMesh engine instance for a given app ID.
 * Each YAML workflow gets its own isolated engine.
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
 * Deploy a YAML workflow to HotMesh (inactive until activated).
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
): Promise<string> {
  const engine = await getEngine(appId);
  return engine.pub(topic, data);
}

/**
 * Invoke a YAML workflow and wait for the result.
 */
export async function invokeYamlWorkflowSync(
  appId: string,
  topic: string,
  data: Record<string, unknown>,
  timeout?: number,
): Promise<Record<string, unknown>> {
  const engine = await getEngine(appId);
  const result = await engine.pubsub(topic, data, null, timeout);
  return result as unknown as Record<string, unknown>;
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
