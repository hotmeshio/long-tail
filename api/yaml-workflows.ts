import * as yamlDb from '../services/yaml-workflow/db';
import * as yamlGenerator from '../services/yaml-workflow/generator';
import * as yamlDeployer from '../services/yaml-workflow/deployer';
import * as yamlWorkers from '../services/yaml-workflow/workers';
import { invokeYamlWorkflow as invokeYamlWorkflowService } from '../services/yaml-workflow/invoke';
import { getTaskByWorkflowId } from '../services/task';
import { cronRegistry } from '../services/cron';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

/** Return true if a Postgres error indicates an invalid/missing ID */
function isNotFoundError(err: any): boolean {
  const msg: string = err?.message ?? '';
  return msg.includes('invalid input syntax for type uuid') || msg.includes('not found');
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listYamlWorkflows(input: {
  status?: string;
  graph_topic?: string;
  app_id?: string;
  search?: string;
  source_workflow_id?: string;
  set_id?: string;
  limit?: number;
  offset?: number;
}): Promise<LTApiResult> {
  try {
    const result = await yamlDb.listYamlWorkflows({
      status: input.status as any,
      graph_topic: input.graph_topic,
      app_id: input.app_id,
      search: input.search,
      source_workflow_id: input.source_workflow_id,
      set_id: input.set_id,
      limit: input.limit,
      offset: input.offset,
    });
    return { status: 200, data: result };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function createYamlWorkflow(input: {
  workflow_id: string;
  task_queue: string;
  workflow_name: string;
  name: string;
  description?: string;
  app_id?: string;
  subscribes?: string;
  tags?: string[];
  compilation_feedback?: string;
}): Promise<LTApiResult> {
  try {
    const { workflow_id, task_queue, workflow_name, name, description, app_id, subscribes, tags: userTags, compilation_feedback } = input;

    if (!workflow_id || !task_queue || !workflow_name || !name) {
      return { status: 400, error: 'workflow_id, task_queue, workflow_name, and name are required' };
    }

    if (/-/.test(name)) {
      return { status: 400, error: 'Name must not contain dashes. Use underscores or camelCase (e.g. "screenshot_analyze_store").' };
    }

    // Reject compilation of executions that exhausted their tool rounds
    const task = await getTaskByWorkflowId(workflow_id);
    if (task) {
      const milestones = task.milestones ?? [];
      const roundsExhausted = milestones.some((m) => m.name === 'rounds_exhausted');
      if (roundsExhausted) {
        return {
          status: 422,
          error: 'Cannot compile: the source execution exhausted its tool rounds without completing the task. Resolve the escalation and resubmit.',
        };
      }
    }

    // Check for topic collision in the target namespace
    const compileAppId = app_id || 'longtail';
    const compileTopic = subscribes || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const conflicting = await yamlDb.checkTopicConflict(compileAppId, compileTopic);
    if (conflicting) {
      return {
        status: 409,
        error: `Topic "${compileTopic}" is already used by workflow "${conflicting}" in namespace "${compileAppId}". Use a different tool name or namespace.`,
      };
    }

    // Generate YAML from execution
    const result = await yamlGenerator.generateYamlFromExecution({
      workflowId: workflow_id,
      taskQueue: task_queue,
      workflowName: workflow_name,
      name,
      description,
      appId: app_id,
      subscribes,
      compilationFeedback: compilation_feedback,
    });

    // Merge auto-derived tags with user-provided tags
    const mergedTags = [...new Set([...(result.tags || []), ...(Array.isArray(userTags) ? userTags : [])])];

    // Store in DB
    const record = await yamlDb.createYamlWorkflow({
      name,
      description,
      app_id: result.appId,
      yaml_content: result.yaml,
      graph_topic: result.graphTopic,
      input_schema: result.inputSchema,
      output_schema: result.outputSchema,
      activity_manifest: result.activityManifest,
      tags: mergedTags,
      source_workflow_id: workflow_id,
      source_workflow_type: workflow_name,
      original_prompt: result.originalPrompt || undefined,
      category: result.category || undefined,
      metadata: {
        input_field_meta: result.inputFieldMeta,
        ...(result.validationIssues?.length ? { validation_warnings: result.validationIssues } : {}),
      },
    });

    return { status: 201, data: record };
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.code === '23505') {
      const msg = err.constraint?.includes('app_topic')
        ? 'A tool with that topic already exists in this namespace'
        : 'A tool with that name already exists';
      return { status: 409, error: msg };
    }
    return { status: 500, error: err.message };
  }
}

export async function createYamlWorkflowDirect(input: {
  name: string;
  description?: string;
  yaml_content: string;
  input_schema?: any;
  activity_manifest?: any[];
  tags?: string[];
  app_id?: string;
  graph_topic?: string;
}): Promise<LTApiResult> {
  try {
    const { name, description, yaml_content, input_schema, activity_manifest, tags, app_id, graph_topic } = input;

    if (!name || !yaml_content) {
      return { status: 400, error: 'name and yaml_content are required' };
    }

    // Sanitize name (tool name): lowercase alphanumeric, periods, dashes, underscores
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9._-]/g, '');

    // Sanitize app_id (MCP server name): force lowercase alphanumeric only
    const targetAppId = (app_id || 'longtail').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Sanitize graph topic: lowercase alphanumeric, periods, dashes, underscores
    let graphTopic = (graph_topic || sanitizedName).toLowerCase().replace(/[^a-z0-9._-]/g, '');
    const subscribesMatch = yaml_content.match(/subscribes:\s*(.+)/);
    if (subscribesMatch) {
      graphTopic = subscribesMatch[1].trim().replace(/^['"]|['"]$/g, '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
    }

    // Rewrite the subscribes line in the YAML to match the sanitized topic
    let finalYaml = yaml_content;
    const subscribesRewrite = finalYaml.match(/^(\s*subscribes:\s*)(.+)$/m);
    if (subscribesRewrite) {
      finalYaml = finalYaml.replace(subscribesRewrite[0], `${subscribesRewrite[1]}${graphTopic}`);
    }

    // Also rewrite the app id line to match the sanitized app_id
    const appIdRewrite = finalYaml.match(/^(\s*id:\s*)(.+)$/m);
    if (appIdRewrite) {
      finalYaml = finalYaml.replace(appIdRewrite[0], `${appIdRewrite[1]}${targetAppId}`);
    }

    // Rewrite worker topic fields to match the sanitized topic
    finalYaml = finalYaml.replace(/^(\s*topic:\s*)(.+)$/gm, `$1${graphTopic}`);

    // Check for topic collision in the target namespace
    const conflicting = await yamlDb.checkTopicConflict(targetAppId, graphTopic);
    if (conflicting) {
      return {
        status: 409,
        error: `Topic "${graphTopic}" is already used by workflow "${conflicting}" in namespace "${targetAppId}". Use a different tool name or namespace.`,
      };
    }

    const wf = await yamlDb.createYamlWorkflow({
      name: sanitizedName,
      description,
      app_id: targetAppId,
      yaml_content: finalYaml,
      graph_topic: graphTopic,
      input_schema: input_schema || {},
      output_schema: {},
      activity_manifest: activity_manifest || [],
      tags: tags || [],
      original_prompt: description,
      category: 'builder',
    });

    return { status: 200, data: wf };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getAppIds(): Promise<LTApiResult> {
  try {
    const appIds = await yamlDb.getDistinctAppIds();
    return { status: 200, data: { app_ids: appIds } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getYamlWorkflow(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 200, data: wf };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function updateYamlWorkflow(input: {
  id: string;
  [key: string]: any;
}): Promise<LTApiResult> {
  try {
    const { id, ...fields } = input;
    const wf = await yamlDb.updateYamlWorkflow(id, fields);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 200, data: wf };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function regenerateYamlWorkflow(input: {
  id: string;
  task_queue?: string;
  compilation_feedback?: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    if (wf.status === 'archived') {
      return { status: 400, error: 'Archived workflows cannot be regenerated' };
    }
    if (!wf.source_workflow_id || !wf.source_workflow_type) {
      return { status: 400, error: 'Missing source workflow reference — cannot regenerate' };
    }

    // Look up task queue from the source task record, or use input override
    let taskQueue = input.task_queue;
    if (!taskQueue) {
      const sourceTask = await getTaskByWorkflowId(wf.source_workflow_id);
      taskQueue = sourceTask?.task_queue || 'v1';
    }

    const feedback = input.compilation_feedback;
    const result = await yamlGenerator.generateYamlFromExecution({
      workflowId: wf.source_workflow_id,
      taskQueue,
      workflowName: wf.source_workflow_type,
      name: wf.name,
      description: wf.description || undefined,
      appId: wf.app_id,
      compilationFeedback: feedback || undefined,
      priorFailedYaml: feedback ? wf.yaml_content : undefined,
    });

    const updated = await yamlDb.updateYamlWorkflow(wf.id, {
      app_id: result.appId,
      graph_topic: result.graphTopic,
      yaml_content: result.yaml,
      input_schema: result.inputSchema,
      output_schema: result.outputSchema,
      activity_manifest: result.activityManifest,
      tags: result.tags,
      metadata: { input_field_meta: result.inputFieldMeta },
    });

    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function deleteYamlWorkflow(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    if (wf.status === 'active' || wf.status === 'deployed') {
      return { status: 400, error: 'Cannot delete an active or deployed workflow. Archive it first.' };
    }
    await yamlDb.deleteYamlWorkflow(input.id);
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export async function deployYamlWorkflow(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }

    // Use the version declared in the YAML (like package.json)
    const deployVersion = wf.app_version || '1';

    // Deploy + activate merged YAML for the full app_id
    const siblings = await yamlDb.listYamlWorkflowsByAppId(wf.app_id);
    await yamlDeployer.deployAppId(wf.app_id, deployVersion);

    // Register workers and mark all non-archived siblings as active
    for (const sibling of siblings) {
      await yamlDb.updateYamlWorkflowVersion(sibling.id, deployVersion);
      await yamlWorkers.registerWorkersForWorkflow(sibling);
      if (sibling.status === 'draft' || sibling.status === 'deployed') {
        await yamlDb.updateYamlWorkflowStatus(sibling.id, 'active');
      }
    }

    // Mark content as deployed for the entire app_id
    await yamlDb.markAppIdContentDeployed(wf.app_id);

    const updated = await yamlDb.getYamlWorkflow(input.id);
    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return {
      status: 500,
      error: err.message,
    };
  }
}

export async function activateYamlWorkflow(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    if (wf.status !== 'deployed' && wf.status !== 'active') {
      return { status: 400, error: 'Workflow must be deployed before activation' };
    }

    await yamlDeployer.activateYamlWorkflow(wf.app_id, wf.app_version);

    // Register workers for ALL workflows sharing this app_id
    const siblings = await yamlDb.listYamlWorkflowsByAppId(wf.app_id);
    for (const sibling of siblings) {
      await yamlWorkers.registerWorkersForWorkflow(sibling);
      if (sibling.status === 'deployed') {
        await yamlDb.updateYamlWorkflowStatus(sibling.id, 'active');
      }
    }

    const updated = await yamlDb.getYamlWorkflow(input.id);
    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function invokeYamlWorkflow(input: {
  id: string;
  data?: any;
  sync?: boolean;
  timeout?: number;
  execute_as?: string;
}, auth?: LTApiAuth): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    if (wf.status !== 'active') {
      return { status: 400, error: 'Workflow must be active to invoke' };
    }

    const result = await invokeYamlWorkflowService(wf, {
      data: input.data,
      sync: input.sync,
      timeout: input.timeout,
      execute_as: input.execute_as,
      userId: auth?.userId,
    });
    return { status: 200, data: result };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function archiveYamlWorkflow(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    if (wf.status === 'active') {
      await yamlDeployer.stopEngine(wf.app_id);
    }
    const updated = await yamlDb.updateYamlWorkflowStatus(wf.id, 'archived');
    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function getVersionHistory(input: {
  id: string;
  limit?: number;
  offset?: number;
}): Promise<LTApiResult> {
  try {
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    const result = await yamlDb.getVersionHistory(input.id, limit, offset);
    return { status: 200, data: result };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function getVersionSnapshot(input: {
  id: string;
  version: number;
}): Promise<LTApiResult> {
  try {
    const version = input.version;
    if (isNaN(version) || version < 1) {
      return { status: 400, error: 'Invalid version number' };
    }
    const snapshot = await yamlDb.getVersionSnapshot(input.id, version);
    if (!snapshot) {
      return { status: 404, error: `Version ${version} not found` };
    }
    return { status: 200, data: snapshot };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function getYamlContent(input: {
  id: string;
  version?: number;
}): Promise<LTApiResult<string>> {
  try {
    if (input.version) {
      const snapshot = await yamlDb.getVersionSnapshot(input.id, input.version);
      if (!snapshot) {
        return { status: 404, error: `Version ${input.version} not found` };
      }
      return { status: 200, data: snapshot.yaml_content };
    }
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 200, data: wf.yaml_content };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

export async function setCronSchedule(input: {
  id: string;
  cron_schedule: string;
  cron_envelope?: any;
  execute_as?: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }

    if (!input.cron_schedule || typeof input.cron_schedule !== 'string') {
      return { status: 400, error: 'cron_schedule is required' };
    }

    const updated = await yamlDb.updateCronSchedule(
      wf.id,
      input.cron_schedule.trim(),
      input.cron_envelope ?? null,
      input.execute_as ?? null,
    );

    if (updated) {
      await cronRegistry.restartYamlCron(updated);
    }

    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function clearCronSchedule(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }

    await cronRegistry.stopYamlCron(wf.id);
    const updated = await yamlDb.clearCronSchedule(wf.id);

    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function getCronStatus(): Promise<LTApiResult> {
  try {
    const workflows = await yamlDb.getCronScheduledWorkflows();
    const activeTypes = cronRegistry.activeWorkflowTypes;

    const schedules = workflows.map((wf) => ({
      id: wf.id,
      name: wf.name,
      graph_topic: wf.graph_topic,
      app_id: wf.app_id,
      cron_schedule: wf.cron_schedule,
      execute_as: wf.execute_as,
      active: activeTypes.includes(`yaml:${wf.id}`),
    }));

    return { status: 200, data: { schedules } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
