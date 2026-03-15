import { Router } from 'express';

import { requireAdmin } from '../modules/auth';
import * as controlplane from '../services/controlplane';

const router = Router();

/**
 * GET /api/controlplane/apps
 * List available HotMesh application IDs.
 * Admin-only.
 */
router.get('/apps', requireAdmin, async (_req, res) => {
  try {
    const apps = await controlplane.listApps();
    res.json({ apps });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/controlplane/rollcall?app_id=durable&delay=1000
 * Execute a roll call — discovers all engines and workers.
 * Admin-only.
 */
router.get('/rollcall', requireAdmin, async (req, res) => {
  try {
    const appId = (req.query.app_id as string) || 'durable';
    const delay = req.query.delay ? parseInt(req.query.delay as string, 10) : undefined;

    const profiles = await controlplane.rollCall(appId, delay);
    res.json({ profiles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  try {
    const { appId = 'durable', throttle, topic, guid } = req.body;

    if (typeof throttle !== 'number') {
      res.status(400).json({ error: 'throttle (number) is required' });
      return;
    }

    const result = await controlplane.applyThrottle(appId, { throttle, topic, guid });
    res.json({ success: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  try {
    const schema = (req.query.app_id as string) || 'durable';
    const duration = (req.query.duration as string) || '1h';
    const stream = (req.query.stream as string) || undefined;
    const stats = await controlplane.getStreamStats(schema, duration, stream);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  try {
    const { appId = 'durable' } = req.body;
    await controlplane.subscribeMesh(appId);
    res.json({ subscribed: true, appId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
