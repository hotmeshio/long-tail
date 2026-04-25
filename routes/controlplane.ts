import { Router } from 'express';

import { requireAdmin } from '../modules/auth';
import * as api from '../api/controlplane';

const router = Router();

/**
 * GET /api/controlplane/apps
 * List available HotMesh application IDs.
 * Admin-only.
 */
router.get('/apps', requireAdmin, async (_req, res) => {
  const result = await api.listApps();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/controlplane/rollcall?app_id=durable&delay=1000
 * Execute a roll call — discovers all engines and workers.
 * Admin-only.
 */
router.get('/rollcall', requireAdmin, async (req, res) => {
  const result = await api.rollCall({
    appId: (req.query.app_id as string) || 'durable',
    delay: req.query.delay ? parseInt(req.query.delay as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/controlplane/throttle
 * Apply a throttle command to the mesh.
 * Admin-only.
 *
 * Body: { appId: string, throttle: number, topic?: string, guid?: string }
 *   throttle: ms delay (-1 = pause, 0 = resume, >0 = delay per msg)
 */
router.post('/throttle', requireAdmin, async (req, res) => {
  const { appId = 'durable', throttle, topic, guid } = req.body;
  const result = await api.applyThrottle({ appId, throttle, topic, guid });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/controlplane/streams?app_id=durable&duration=1h&stream=hmsh:durable:x:
 * Stream processing statistics — pending count + processed volume by time range.
 * Admin-only.
 *
 * duration: 15m | 30m | 1h | 1d | 7d (default: 1h)
 * stream: optional stream_name filter (specific task queue topic)
 */
router.get('/streams', requireAdmin, async (req, res) => {
  const result = await api.getStreamStats({
    app_id: (req.query.app_id as string) || 'durable',
    duration: (req.query.duration as string) || '1h',
    stream: (req.query.stream as string) || undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/controlplane/subscribe
 * Start the quorum→NATS bridge for an appId.
 * Subscribes to the HotMesh quorum channel and republishes
 * all control plane messages to NATS on `lt.mesh.*` topics.
 * Admin-only.
 *
 * Body: { appId: string }
 */
router.post('/subscribe', requireAdmin, async (req, res) => {
  const { appId = 'durable' } = req.body;
  const result = await api.subscribeMesh({ appId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
