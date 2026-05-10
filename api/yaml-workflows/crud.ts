import * as yamlDb from '../../services/yaml-workflow/db';
import * as yamlGenerator from '../../services/yaml-workflow/generator';
import { getTaskByWorkflowId } from '../../services/task';
import { sanitizeToolName, sanitizeServerName } from '../../modules/utils';
import type { LTApiResult } from '../../types/sdk';
import { isNotFoundError } from './helpers';

/**
 * List YAML workflows with optional filtering and pagination.
 *
 * Delegates to the DB layer. Returns 404 when a filter references an invalid UUID.
 *
 * @param input.status — lifecycle filter (draft, deployed, active, archived)
 * @param input.graph_topic — filter by the HotMesh subscription topic
 * @param input.app_id — filter by namespace (MCP server name)
 * @param input.search — free-text search across workflow name/description
 * @param input.source_workflow_id — filter by the execution trace this workflow was compiled from
 * @param input.set_id — filter by compositional set membership
 * @param input.limit — max rows to return
 * @param input.offset — pagination offset
 * @returns `{ status: 200, data: YamlWorkflow[] }` matching workflows
 */
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

/**
 * Compile an execution trace into a new YAML workflow (draft).
 *
 * Validates that the source execution did not exhaust its tool rounds, checks for
 * topic collisions in the target namespace, then delegates to the LLM-based YAML
 * generator. The resulting YAML, schemas, and activity manifest are persisted as a
 * new draft record. Auto-derived tags are merged with any user-supplied tags.
 *
 * @param input.workflow_id — ID of the source execution trace to compile from
 * @param input.task_queue — HotMesh task queue the source execution ran on
 * @param input.workflow_name — type name of the source workflow
 * @param input.name — tool name for the new workflow (no dashes; used to derive the topic)
 * @param input.description — human-readable description passed to the generator
 * @param input.app_id — target namespace (defaults to "longtail")
 * @param input.subscribes — explicit subscription topic override (otherwise derived from name)
 * @param input.tags — additional tags to merge with auto-derived tags
 * @param input.compilation_feedback — natural-language feedback to steer the LLM compilation
 * @returns `{ status: 201, data: YamlWorkflow }` the newly created draft record
 */
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
    const compileAppId = sanitizeServerName(app_id || 'longtail');
    const compileTopic = sanitizeToolName(subscribes || name);
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

/**
 * Create a YAML workflow directly from user-supplied YAML content (no compilation).
 *
 * Sanitizes the name, app_id, and graph_topic to lowercase alphanumeric characters.
 * Rewrites the `subscribes`, `id`, and `topic` fields inside the YAML to match the
 * sanitized values. Checks for topic collisions before persisting.
 *
 * @param input.name — tool name (sanitized to lowercase alphanumeric, periods, dashes, underscores)
 * @param input.description — human-readable description; also stored as original_prompt
 * @param input.yaml_content — raw HotMesh YAML definition
 * @param input.input_schema — JSON Schema describing the workflow's input (defaults to empty object)
 * @param input.activity_manifest — list of activity declarations (defaults to empty array)
 * @param input.tags — classification tags (defaults to empty array)
 * @param input.app_id — target namespace / MCP server name (defaults to "longtail", sanitized to lowercase alphanumeric)
 * @param input.graph_topic — subscription topic override (defaults to sanitized name; overridden by `subscribes` in YAML if present)
 * @returns `{ status: 200, data: YamlWorkflow }` the persisted workflow record
 */
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

    // Sanitize name (tool name): snake_case only
    const sanitizedName = sanitizeToolName(name);

    // Sanitize app_id (MCP server name): lowercase alphanumeric, must start with a letter
    const targetAppId = sanitizeServerName(app_id || 'longtail');

    // Sanitize graph topic: snake_case only
    let graphTopic = sanitizeToolName(graph_topic || sanitizedName);
    const subscribesMatch = yaml_content.match(/subscribes:\s*(.+)/);
    if (subscribesMatch) {
      graphTopic = sanitizeToolName(subscribesMatch[1].trim().replace(/^['"]|['"]$/g, ''));
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

/**
 * Retrieve all distinct app_id namespaces that have at least one YAML workflow.
 *
 * @returns `{ status: 200, data: { app_ids: string[] } }` sorted list of namespace identifiers
 */
export async function getAppIds(): Promise<LTApiResult> {
  try {
    const appIds = await yamlDb.getDistinctAppIds();
    return { status: 200, data: { app_ids: appIds } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Fetch a single YAML workflow by its primary key.
 *
 * @param input.id — UUID of the workflow record
 * @returns `{ status: 200, data: YamlWorkflow }` the full workflow record, or 404 if not found
 */
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

/**
 * Partially update a YAML workflow record.
 *
 * Accepts arbitrary fields beyond `id` and forwards them to the DB update layer.
 *
 * @param input.id — UUID of the workflow to update
 * @param input.[key] — any mutable workflow fields (name, description, yaml_content, tags, etc.)
 * @returns `{ status: 200, data: YamlWorkflow }` the updated record, or 404 if not found
 */
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

/**
 * Re-compile an existing YAML workflow from its original execution trace.
 *
 * Looks up the source workflow reference, re-runs the LLM-based YAML generator, and
 * overwrites the YAML content, schemas, manifest, and tags in place. When
 * compilation_feedback is provided, the current YAML is passed as priorFailedYaml so
 * the generator can incorporate the feedback. Archived workflows cannot be regenerated.
 *
 * @param input.id — UUID of the workflow to regenerate
 * @param input.task_queue — override the task queue (otherwise resolved from the source task record)
 * @param input.compilation_feedback — natural-language feedback to steer the re-compilation
 * @returns `{ status: 200, data: YamlWorkflow }` the updated record with new YAML content
 */
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

/**
 * Permanently delete a YAML workflow record.
 *
 * Only draft or archived workflows can be deleted. Active or deployed workflows must
 * be archived first.
 *
 * @param input.id — UUID of the workflow to delete
 * @returns `{ status: 200, data: { deleted: true } }` on success, or 400 if the workflow is active/deployed
 */
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
