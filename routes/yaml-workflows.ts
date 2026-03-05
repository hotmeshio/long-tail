import { Router } from 'express';

import * as yamlDb from '../services/yaml-workflow/db';
import * as yamlGenerator from '../services/yaml-workflow/generator';
import * as yamlDeployer from '../services/yaml-workflow/deployer';
import * as yamlWorkers from '../services/yaml-workflow/workers';

const router = Router();

/**
 * GET /api/yaml-workflows
 * List YAML workflows with optional status filter.
 */
router.get('/', async (req, res) => {
  try {
    const result = await yamlDb.listYamlWorkflows({
      status: req.query.status as any,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
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
    const { workflow_id, task_queue, workflow_name, name, description } = req.body;
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/yaml-workflows/:id/deploy
 * Deploy a YAML workflow via HotMesh CompilerService.
 */
router.post('/:id/deploy', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    await yamlDeployer.deployYamlWorkflow(wf.app_id, wf.yaml_content);
    const updated = await yamlDb.updateYamlWorkflowStatus(wf.id, 'deployed');
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/yaml-workflows/:id/activate
 * Activate a deployed YAML workflow and register workers.
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
    await yamlWorkers.registerWorkersForWorkflow(wf);
    const updated = await yamlDb.updateYamlWorkflowStatus(wf.id, 'active');
    res.json(updated);
  } catch (err: any) {
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
      const result = await yamlDeployer.invokeYamlWorkflowSync(
        wf.app_id,
        wf.graph_topic,
        data,
        req.body.timeout,
      );
      res.json({ result });
    } else {
      const jobId = await yamlDeployer.invokeYamlWorkflow(
        wf.app_id,
        wf.graph_topic,
        data,
      );
      res.json({ job_id: jobId });
    }
  } catch (err: any) {
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/yaml-workflows/:id/yaml
 * Return raw YAML content.
 */
router.get('/:id/yaml', async (req, res) => {
  try {
    const wf = await yamlDb.getYamlWorkflow(req.params.id);
    if (!wf) {
      res.status(404).json({ error: 'YAML workflow not found' });
      return;
    }
    res.type('text/yaml').send(wf.yaml_content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
