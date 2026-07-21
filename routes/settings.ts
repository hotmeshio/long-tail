import { createHash } from 'crypto';

import { Router } from 'express';

import * as api from '../api/settings';
import { getCustomCss } from '../modules/branding';

const router = Router();

/**
 * GET /api/settings
 * Returns frontend-relevant configuration (no secrets).
 */
router.get('/', async (req, res) => {
  const result = await api.getSettings(req);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/settings/custom.css
 * The deployment's registered design-system overrides (branding.customCss +
 * registered theme blocks). Always 200 text/css — empty when nothing is
 * registered — so the dashboard references it unconditionally with no flash
 * and no conditional logic. ETag lets the browser cache it across loads.
 */
router.get('/custom.css', (req, res) => {
  const css = getCustomCss();
  const etag = `"${createHash('sha1').update(css).digest('hex')}"`;
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).send(css);
});

export default router;
