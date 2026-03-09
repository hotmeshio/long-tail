import { HotMesh } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type { HotMeshManifest } from '@hotmeshio/hotmesh/build/types/hotmesh';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

import { postgres_options } from '../../modules/config';
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

  const merged = {
    app: {
      id: appId,
      version,
      graphs: allGraphs,
    },
  };

  return yaml.dump(merged, { lineWidth: 120, noRefs: true, sortKeys: false });
}

/**
 * Deploy all YAML workflows for an app_id as a single merged version.
 */
export async function deployAppId(
  appId: string,
  version: string,
): Promise<HotMeshManifest> {
  // Auto-register the namespace so it appears in the UI
  await namespaceService.registerNamespace(appId);

  const mergedYaml = await buildMergedYaml(appId, version);
  const engine = await getEngine(appId);
  const manifest = await engine.deploy(mergedYaml);
  loggerRegistry.info(`[yaml-workflow] deployed ${appId} v${version} (merged)`);
  return manifest;
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
 * Uses engine.pubsub which internally subscribes, publishes, and
 * unsubscribes — handling the full request/response lifecycle.
 */
export async function invokeYamlWorkflowSync(
  appId: string,
  topic: string,
  data: Record<string, unknown>,
  timeout?: number,
): Promise<Record<string, unknown>> {
  const engine = await getEngine(appId);
  const result = await engine.pubsub(topic, data, null, timeout ?? 120000);
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
