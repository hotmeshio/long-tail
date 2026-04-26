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

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/**
 * Deploy a YAML workflow and all sibling workflows sharing its app_id namespace.
 *
 * Merges and deploys the full app_id YAML, registers HotMesh workers for every
 * non-archived sibling, transitions draft/deployed siblings to active, and marks
 * the app_id content as deployed. Uses the app_version declared in the workflow record.
 *
 * @param input.id — UUID of the workflow to deploy
 * @returns `{ status: 200, data: YamlWorkflow }` the refreshed workflow record after deployment
 */
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

/**
 * Activate a previously deployed YAML workflow and its app_id siblings.
 *
 * Calls the deployer to activate the app_id at its current version, then registers
 * HotMesh workers for all sibling workflows. Siblings in "deployed" status are
 * transitioned to "active". The workflow must already be in deployed or active status.
 *
 * @param input.id — UUID of the workflow to activate
 * @returns `{ status: 200, data: YamlWorkflow }` the refreshed workflow record after activation
 */
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

/**
 * Invoke an active YAML workflow, executing its DAG pipeline.
 *
 * The workflow must be in "active" status. Delegates to the invoke service which
 * starts the HotMesh execution. Supports both synchronous (wait for result) and
 * asynchronous (fire-and-forget) invocation modes.
 *
 * @param input.id — UUID of the workflow to invoke
 * @param input.data — input payload passed to the workflow's entry point
 * @param input.sync — when true, block until the workflow completes and return its output
 * @param input.timeout — max milliseconds to wait when sync is true
 * @param input.execute_as — override identity for the execution context
 * @param auth — authenticated user context; userId is forwarded to the invoke service
 * @returns `{ status: 200, data: ... }` workflow execution result (sync) or job metadata (async)
 */
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

/**
 * Archive a YAML workflow, removing it from active service.
 *
 * If the workflow is currently active, its HotMesh engine is stopped before
 * transitioning the status to "archived". Archived workflows cannot be invoked
 * or regenerated but can still be viewed or deleted.
 *
 * @param input.id — UUID of the workflow to archive
 * @returns `{ status: 200, data: YamlWorkflow }` the updated record with status "archived"
 */
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

/**
 * Retrieve the version history for a YAML workflow.
 *
 * Returns a paginated list of version snapshots ordered by version number.
 *
 * @param input.id — UUID of the workflow
 * @param input.limit — max versions to return (defaults to 20)
 * @param input.offset — pagination offset (defaults to 0)
 * @returns `{ status: 200, data: VersionSnapshot[] }` paginated version history
 */
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

/**
 * Retrieve a specific version snapshot of a YAML workflow.
 *
 * Validates that the version number is a positive integer before querying.
 *
 * @param input.id — UUID of the workflow
 * @param input.version — 1-based version number to retrieve
 * @returns `{ status: 200, data: VersionSnapshot }` the snapshot at the requested version, or 404
 */
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

/**
 * Retrieve the raw YAML content for a workflow, optionally at a specific version.
 *
 * When a version is provided, fetches from the version snapshot table. Otherwise
 * returns the current yaml_content from the live workflow record.
 *
 * @param input.id — UUID of the workflow
 * @param input.version — optional version number; when omitted, returns the current content
 * @returns `{ status: 200, data: string }` the raw YAML string
 */
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

/**
 * Set or update the cron schedule for a YAML workflow.
 *
 * Persists the schedule in the DB and restarts the in-process cron timer via the
 * cron registry so the change takes effect immediately.
 *
 * @param input.id — UUID of the workflow to schedule
 * @param input.cron_schedule — cron expression (e.g. "0 * * * *")
 * @param input.cron_envelope — optional payload passed to each scheduled invocation
 * @param input.execute_as — optional identity override for scheduled executions
 * @returns `{ status: 200, data: YamlWorkflow }` the updated workflow record with cron fields set
 */
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

/**
 * Remove the cron schedule from a YAML workflow.
 *
 * Stops the in-process cron timer first, then clears the schedule fields in the DB.
 *
 * @param input.id — UUID of the workflow to unschedule
 * @returns `{ status: 200, data: YamlWorkflow }` the updated workflow record with cron fields cleared
 */
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

/**
 * List all YAML workflows that have a cron schedule, with their live timer status.
 *
 * Fetches all cron-scheduled workflows from the DB and cross-references with the
 * in-process cron registry to determine which timers are actually running.
 *
 * @returns `{ status: 200, data: { schedules: Array<{ id, name, graph_topic, app_id, cron_schedule, execute_as, active }> } }`
 */
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
