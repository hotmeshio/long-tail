import { Router } from 'express';

import * as api from '../api/announcements';
import { requireRoleManager } from '../modules/auth';

const router = Router();

/**
 * Dashboard announcements. Publishing and removal are role-manager acts
 * (superadmin, admin type, or engineer); any authenticated user reads their
 * role-filtered slice. Targeting is display scoping — the live event
 * broadcasts to every authenticated subscriber.
 */

router.get('/', async (req, res) => {
  const result = await api.listAnnouncements(req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

router.post('/', requireRoleManager, async (req, res) => {
  const result = await api.createAnnouncement(
    {
      body: req.body?.body,
      title: req.body?.title,
      layout: req.body?.layout,
      roles: req.body?.roles,
      expiresAt: req.body?.expiresAt,
    },
    req.auth!,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

router.delete('/:id', requireRoleManager, async (req, res) => {
  const result = await api.deleteAnnouncement({ id: String(req.params.id) }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
