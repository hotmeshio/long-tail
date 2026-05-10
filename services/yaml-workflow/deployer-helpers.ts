// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml');

import { YAML_LINE_WIDTH } from '../../modules/defaults';
import { loggerRegistry } from '../../lib/logger';
import * as yamlDb from './db';

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

  // Resolve duplicate activity IDs across graphs by rewriting suffixes
  const activityIds = new Set<string>();
  for (const graph of allGraphs) {
    const g = graph as { subscribes?: string; activities?: Record<string, unknown>; transitions?: Record<string, unknown>; hooks?: Record<string, unknown> };
    if (!g.activities) continue;

    // Check if any activity IDs collide with previously seen IDs
    const ids = Object.keys(g.activities);
    const hasCollision = ids.some((id) => activityIds.has(id));

    if (hasCollision) {
      // Rewrite all activity IDs in this graph with a unique suffix
      const newSuffix = Math.random().toString(36).slice(2, 6);
      const oldSuffix = extractSuffix(ids[0]);
      if (oldSuffix) {
        rewriteGraphSuffix(g, oldSuffix, newSuffix);
        loggerRegistry.info(
          `[yaml-workflow] rewrote activity suffix ${oldSuffix}→${newSuffix} in "${g.subscribes}" to resolve collision`,
        );
      }
    }

    // Register all (possibly rewritten) activity IDs
    for (const id of Object.keys(g.activities)) {
      activityIds.add(id);
    }
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

/** Extract the 4-char suffix from an activity ID like "trigger_x8kf" */
function extractSuffix(activityId: string): string | null {
  const match = activityId.match(/_([a-z0-9]{4})$/);
  return match ? match[1] : null;
}

/** Rewrite all activity ID suffixes in a graph definition */
function rewriteGraphSuffix(
  graph: { activities?: Record<string, unknown>; transitions?: Record<string, unknown>; hooks?: Record<string, unknown> },
  oldSuffix: string,
  newSuffix: string,
): void {
  const suffixPattern = new RegExp(`_${oldSuffix}\\b`, 'g');
  const replace = (obj: any): any => {
    if (typeof obj === 'string') return obj.replace(suffixPattern, `_${newSuffix}`);
    if (Array.isArray(obj)) return obj.map(replace);
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        const newKey = k.replace(suffixPattern, `_${newSuffix}`);
        result[newKey] = replace(v);
      }
      return result;
    }
    return obj;
  };

  if (graph.activities) graph.activities = replace(graph.activities);
  if (graph.transitions) graph.transitions = replace(graph.transitions);
  if (graph.hooks) graph.hooks = replace(graph.hooks);
}

/**
 * Re-run the compilation pipeline for the most recently compiled workflow
 * in the app, feeding the deployment error as context so the LLM can
 * produce a plan that avoids the same issue.
 *
 * Returns true if recompilation succeeded and the DB was updated, false otherwise.
 */
export async function recompileWithContext(
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
