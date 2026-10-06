import { Router } from '../../lib/http';

import * as api from '../../api/yaml-workflows';
import { requireBuilder } from '../../modules/auth';

const router = Router();

/**
 * POST /api/yaml-workflows/:id/deploy
 * Deploy all YAML workflows sharing this workflow's app_id as a merged version.
 * Bumps the version and deploys all graphs together.
 */
router.post('/:id/deploy', requireBuilder, async (req, res) => {
  const result = await api.deployYamlWorkflow({ id: String(req.params.id) }, req.auth);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/yaml-workflows/:id/activate
 * Activate the deployed version for this workflow's app_id and register all workers.
 */
router.post('/:id/activate', requireBuilder, async (req, res) => {
  const result = await api.activateYamlWorkflow({ id: String(req.params.id) }, req.auth);
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
router.post('/:id/archive', requireBuilder, async (req, res) => {
  const result = await api.archiveYamlWorkflow({ id: String(req.params.id) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/yaml-workflows/:id/restore
 * Restore an archived YAML workflow back to draft status for redeployment.
 */
router.post('/:id/restore', requireBuilder, async (req, res) => {
  const result = await api.restoreYamlWorkflow({ id: String(req.params.id) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
