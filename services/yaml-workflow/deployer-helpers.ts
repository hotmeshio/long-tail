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

  // Pre-validate: check for duplicate activity IDs across all graphs
  const activityIds = new Map<string, string>(); // id -> graph subscribes topic
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
