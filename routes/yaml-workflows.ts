import { Router } from 'express';

import * as yamlDb from '../services/yaml-workflow/db';
import * as yamlGenerator from '../services/yaml-workflow/generator';
import * as yamlDeployer from '../services/yaml-workflow/deployer';
import * as yamlWorkers from '../services/yaml-workflow/workers';
import { getTaskByWorkflowId } from '../services/task';

const router = Router();

/** Return true if a Postgres error indicates an invalid/missing ID */
function isNotFoundError(err: any): boolean {
  const msg: string = err?.message ?? '';
  return msg.includes('invalid input syntax for type uuid') || msg.includes('not found');
}

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
    const { workflow_id, task_queue, workflow_name, name, description, app_id, subscribes } = req.body;
    if (!workflow_id || !task_queue || !workflow_name || !name) {
      res.status(400).json({
        error: 'workflow_id, task_queue, workflow_name, and name are required',
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
    });

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
      tags: result.tags,
      source_workflow_id: workflow_id,
      source_workflow_type: workflow_name,
    });

    res.status(201).json(record);
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.code === '23505') {
      res.status(409).json({ error: 'A YAML workflow with that name already exists' });
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

// ── Parameterized routes ──────────────────────────────────────────────

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
 * Re-generate the YAML from the original source execution (e.g., after generator improvements).
 * Only allowed for draft workflows.
 */
router.post('/:id/regenerate', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    if (wf.status !== 'draft') {
      res.status(400).json({ error: 'Only draft workflows can be regenerated' });
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

    const result = await yamlGenerator.generateYamlFromExecution({
      workflowId: wf.source_workflow_id,
      taskQueue,
      workflowName: wf.source_workflow_type,
      name: wf.name,
      description: wf.description || undefined,
      appId: wf.app_id,
    });

    const updated = await yamlDb.updateYamlWorkflow(wf.id, {
      app_id: result.appId,
      graph_topic: result.graphTopic,
      yaml_content: result.yaml,
      input_schema: result.inputSchema,
      output_schema: result.outputSchema,
      activity_manifest: result.activityManifest,
      tags: result.tags,
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

/**
 * POST /api/yaml-workflows/:id/deploy
 * Deploy all YAML workflows sharing this workflow's app_id as a merged version.
 * Bumps the version and deploys all graphs together.
 */
router.post('/:id/deploy', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
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

    const updated = await yamlDb.getYamlWorkflow(req.params.id);
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
 * POST /api/yaml-workflows/:id/activate
 * Activate the deployed version for this workflow's app_id and register all workers.
 */
router.post('/:id/activate', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    if (wf.status !== 'deployed' && wf.status !== 'active') {
      res.status(400).json({ error: 'Workflow must be deployed before activation' });
      return;
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

    const updated = await yamlDb.getYamlWorkflow(req.params.id);
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
 * POST /api/yaml-workflows/:id/invoke
 * Invoke an active YAML workflow with parameters.
 * Body: { data, sync?: boolean }
 */
router.post('/:id/invoke', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    if (wf.status !== 'active') {
      res.status(400).json({ error: 'Workflow must be active to invoke' });
      return;
    }
    const data = req.body.data || {};
    if (req.body.sync) {
      const { job_id, result } = await yamlDeployer.invokeYamlWorkflowSync(
        wf.app_id,
        wf.graph_topic,
        data,
        req.body.timeout,
        wf.graph_topic,
      );
      res.json({ job_id, result });
    } else {
      const jobId = await yamlDeployer.invokeYamlWorkflow(
        wf.app_id,
        wf.graph_topic,
        data,
        wf.graph_topic,
      );
      res.json({ job_id: jobId });
    }
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/yaml-workflows/:id/archive
 * Archive a YAML workflow (stops accepting new invocations).
 */
router.post('/:id/archive', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    if (wf.status === 'active') {
      await yamlDeployer.stopEngine(wf.app_id);
    }
    const updated = await yamlDb.updateYamlWorkflowStatus(wf.id, 'archived');
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
 * GET /api/yaml-workflows/:id/versions
 * Return version history for a YAML workflow.
 */
router.get('/:id/versions', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const result = await yamlDb.getVersionHistory(req.params.id, limit, offset);
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
 * GET /api/yaml-workflows/:id/versions/:version
 * Return a single version snapshot with YAML, schemas, and manifest.
 */
router.get('/:id/versions/:version', async (req, res) => {
  try {
    const version = parseInt(req.params.version, 10);
    if (isNaN(version) || version < 1) {
      res.status(400).json({ error: 'Invalid version number' });
      return;
    }
    const snapshot = await yamlDb.getVersionSnapshot(req.params.id, version);
    if (!snapshot) {
      res.status(404).json({ error: `Version ${version} not found` });
      return;
    }
    res.json(snapshot);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/yaml-workflows/:id/yaml
 * Return raw YAML content. Supports ?version=N query param.
 */
router.get('/:id/yaml', async (req, res) => {
  try {
    const versionParam = req.query.version ? parseInt(req.query.version as string, 10) : null;
    if (versionParam) {
      const snapshot = await yamlDb.getVersionSnapshot(req.params.id, versionParam);
      if (!snapshot) {
        res.status(404).json({ error: `Version ${versionParam} not found` });
        return;
      }
      res.type('text/yaml').send(snapshot.yaml_content);
      return;
    }
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.type('text/yaml').send(wf.yaml_content);
  } catch (err: any) {
    if (isNotFoundError(err)) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
