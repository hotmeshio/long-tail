import { Router } from '../../lib/http';
import { requireAuth } from '../../modules/auth';
import { getUserRoles } from '../../services/user/roles';
import { listGrants, revokeGrant } from '../../services/auth/oauth-server';
import { grantablePresets } from '../../services/auth/oauth-server/authorization';
import { revokeEverywhere } from '../../services/auth/oauth-server/revocation-events';

const router = Router();

/**
 * GET /api/oauth/presets
 * The presets the signed-in person may grant at consent.
 */
router.get('/presets', requireAuth, async (req, res) => {
  res.json({ presets: grantablePresets(await getUserRoles(req.auth!.userId)) });
});

/**
 * GET /api/oauth/grants
 * The signed-in person's connected apps.
 */
router.get('/grants', requireAuth, async (req, res) => {
  res.json({ grants: await listGrants(req.auth!.userId) });
});

/**
 * DELETE /api/oauth/grants/:id
 * Disconnect one of the signed-in person's apps. Its tokens stop working at once.
 */
router.delete('/grants/:id', requireAuth, async (req, res) => {
  const revoked = await revokeGrant(String(req.params.id), req.auth!.userId);
  if (!revoked) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  revokeEverywhere(revoked.grant_id);
  res.json({ disconnected: true });
});

export default router;
