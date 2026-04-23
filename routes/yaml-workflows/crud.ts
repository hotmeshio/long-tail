import { Router } from 'express';

import * as yamlDb from '../../services/yaml-workflow/db';
import * as yamlGenerator from '../../services/yaml-workflow/generator';
import { getTaskByWorkflowId } from '../../services/task';

import { isNotFoundError } from './helpers';

const router = Router();

/**
 * GET /api/yaml-workflows
 * List YAML workflows with optional status filter.
 */
router.get('/', async (req, res) => {
  try {
    const result = await yamlDb.listYamlWorkflows({
      status: req.query.status as any,
      graph_topic: req.query.graph_topic as string | undefined,
      app_id: req.query.app_id as string | undefined,
      search: req.query.search as string | undefined,
      source_workflow_id: req.query.source_workflow_id as string | undefined,
      set_id: req.query.set_id as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/yaml-workflows
 * Generate a YAML workflow from a completed execution.
 * Body: { workflow_id, task_queue, workflow_name, name, description? }
 */
router.post('/', async (req, res) => {
  try {
    const { workflow_id, task_queue, workflow_name, name, description, app_id, subscribes, tags: userTags, compilation_feedback } = req.body;
    if (!workflow_id || !task_queue || !workflow_name || !name) {
      res.status(400).json({
        error: 'workflow_id, task_queue, workflow_name, and name are required',
      });
      return;
    }

    if (/-/.test(name)) {
      res.status(400).json({ error: 'Name must not contain dashes. Use underscores or camelCase (e.g. "screenshot_analyze_store").' });
      return;
    }

    // Reject compilation of executions that exhausted their tool rounds —
    // the trace is incomplete and would produce a broken workflow.
    const task = await getTaskByWorkflowId(workflow_id);
    if (task) {
      const milestones = task.milestones ?? [];
      const roundsExhausted = milestones.some((m) => m.name === 'rounds_exhausted');
      if (roundsExhausted) {
        res.status(422).json({
          error: 'Cannot compile: the source execution exhausted its tool rounds without completing the task. Resolve the escalation and resubmit.',
        });
        return;
      }
    }

    // Check for topic collision in the target namespace
    const compileAppId = app_id || 'longtail';
    const compileTopic = subscribes || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const conflicting = await yamlDb.checkTopicConflict(compileAppId, compileTopic);
    if (conflicting) {
      res.status(409).json({
        error: `Topic "${compileTopic}" is already used by workflow "${conflicting}" in namespace "${compileAppId}". Use a different tool name or namespace.`,
      });
      return;
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

    res.status(201).json(record);
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.code === '23505') {
      const msg = err.constraint?.includes('app_topic')
        ? 'A tool with that topic already exists in this namespace'
        : 'A tool with that name already exists';
      res.status(409).json({ error: msg });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/yaml-workflows/app-ids
 * Return distinct app_id values from non-archived workflows.
 */
router.get('/app-ids', async (_req, res) => {
  try {
    const appIds = await yamlDb.getDistinctAppIds();
    res.json({ app_ids: appIds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/yaml-workflows/direct
 * Create a YAML workflow from raw YAML content (workflow builder output).
 * Unlike POST /, this does not require a source execution — the YAML is provided directly.
 * Body: { name, description?, yaml_content, input_schema?, activity_manifest?, tags?, app_id? }
 */
router.post('/direct', async (req, res) => {
  try {
    const { name, description, yaml_content, input_schema, activity_manifest, tags, app_id, graph_topic } = req.body;
    if (!name || !yaml_content) {
      res.status(400).json({ error: 'name and yaml_content are required' });
      return;
    }

    // Sanitize name (tool name): force lowercase alphanumeric only
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Sanitize app_id (MCP server name): force lowercase alphanumeric only
    const targetAppId = (app_id || 'longtail').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Sanitize graph topic: force lowercase alphanumeric only
    let graphTopic = (graph_topic || sanitizedName).toLowerCase().replace(/[^a-z0-9]/g, '');
    const subscribesMatch = yaml_content.match(/subscribes:\s*(.+)/);
    if (subscribesMatch) {
      graphTopic = subscribesMatch[1].trim().replace(/^['"]|['"]$/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    // Check for topic collision in the target namespace
    const conflicting = await yamlDb.checkTopicConflict(targetAppId, graphTopic);
    if (conflicting) {
      res.status(409).json({
        error: `Topic "${graphTopic}" is already used by workflow "${conflicting}" in namespace "${targetAppId}". Use a different tool name or namespace.`,
      });
      return;
    }

    const wf = await yamlDb.createYamlWorkflow({
      name: sanitizedName,
      description,
      app_id: targetAppId,
      yaml_content,
      graph_topic: graphTopic,
      input_schema: input_schema || {},
      output_schema: {},
      activity_manifest: activity_manifest || [],
      tags: tags || [],
      original_prompt: description,
      category: 'builder',
    });

    res.json(wf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -- Parameterized routes --

/**
 * GET /api/yaml-workflows/:id
 * Get a single YAML workflow.
 */
router.get('/:id', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.json(wf);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/yaml-workflows/:id
 * Update a YAML workflow's metadata.
 */
router.put('/:id', async (req, res) => {
  try {
    const wf = await yamlDb.updateYamlWorkflow(req.params.id, req.body);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.json(wf);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/yaml-workflows/:id/regenerate
 * Re-generate the YAML from the original source execution.
 * Only allowed for non-archived workflows.
 */
router.post('/:id/regenerate', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    if (wf.status === 'archived') {
      res.status(400).json({ error: 'Archived workflows cannot be regenerated' });
      return;
    }
    if (!wf.source_workflow_id || !wf.source_workflow_type) {
      res.status(400).json({ error: 'Missing source workflow reference — cannot regenerate' });
      return;
    }

    // Look up task queue from the source task record, or use body override
    let taskQueue = req.body.task_queue;
    if (!taskQueue) {
      const sourceTask = await getTaskByWorkflowId(wf.source_workflow_id);
      taskQueue = sourceTask?.task_queue || 'v1';
    }

    const feedback = req.body.compilation_feedback;
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

    res.json(updated);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/yaml-workflows/:id
 * Delete a YAML workflow (must be draft or archived).
 */
router.delete('/:id', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    if (wf.status === 'active' || wf.status === 'deployed') {
      res.status(400).json({ error: 'Cannot delete an active or deployed workflow. Archive it first.' });
      return;
    }
    await yamlDb.deleteYamlWorkflow(req.params.id);
    res.json({ deleted: true });
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
