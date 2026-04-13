import { Router } from 'express';

import * as yamlDb from '../../services/yaml-workflow/db';
import * as yamlDeployer from '../../services/yaml-workflow/deployer';
import * as yamlWorkers from '../../services/yaml-workflow/workers';

import { isNotFoundError } from './helpers';

const router = Router();

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
    res.status(500).json({
      error: err.message,
      hint: err.message.includes('Duplicate activity id')
        ? 'Colliding activity IDs across workflows. A Claude Code repair was attempted — check server logs. You may need to archive conflicting workflows and recompile.'
        : undefined,
    });
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

    // Inject _scope so compiled workflow activities have identity context
    if (req.auth?.userId && !data._scope) {
      const { resolvePrincipal } = await import('../../services/iam/principal');
      const principal = await resolvePrincipal(req.auth.userId);
      if (principal) {
        data._scope = {
          principal,
          scopes: ['mcp:tool:call'],
        };
      }
    }

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

export default router;
