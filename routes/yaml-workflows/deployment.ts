import { Router } from 'express';

import * as api from '../../api/yaml-workflows';

const router = Router();

/**
 * POST /api/yaml-workflows/:id/deploy
 * Deploy all YAML workflows sharing this workflow's app_id as a merged version.
 * Bumps the version and deploys all graphs together.
 */
router.post('/:id/deploy', async (req, res) => {
  const result = await api.deployYamlWorkflow({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/yaml-workflows/:id/activate
 * Activate the deployed version for this workflow's app_id and register all workers.
 */
router.post('/:id/activate', async (req, res) => {
  const result = await api.activateYamlWorkflow({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/yaml-workflows/:id/invoke
 * Invoke an active YAML workflow with parameters.
 * Body: { data, sync?: boolean }
 */
router.post('/:id/invoke', async (req, res) => {
  const result = await api.invokeYamlWorkflow(
    {
      id: req.params.id,
      data: req.body.data,
      sync: req.body.sync,
      timeout: req.body.timeout,
      execute_as: req.body.execute_as,
    },
    req.auth?.userId ? { userId: req.auth.userId } : undefined,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/yaml-workflows/:id/archive
 * Archive a YAML workflow (stops accepting new invocations).
 */
router.post('/:id/archive', async (req, res) => {
  const result = await api.archiveYamlWorkflow({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
