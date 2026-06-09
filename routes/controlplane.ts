import { Router } from 'express';

import { requireBuilder } from '../modules/auth';
import * as api from '../api/controlplane';

const router = Router();

/**
 * GET /api/controlplane/apps
 * List available HotMesh application namespaces.
 * Builder-only.
 */
router.get('/apps', requireBuilder, async (_req, res) => {
  const result = await api.listApps();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/controlplane/rollcall?app_id=durable&delay=1000
 * Execute a roll call — discovers all engines and workers.
 * Builder-only. app_id is required.
 */
router.get('/rollcall', requireBuilder, async (req, res) => {
  const appId = req.query.app_id as string;
  if (!appId) {
    res.status(400).json({ error: 'app_id query parameter is required' });
    return;
  }
  const result = await api.rollCall({
    appId,
    delay: req.query.delay ? parseInt(req.query.delay as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/controlplane/throttle
 * Apply a throttle command to the mesh.
 * Builder-only. appId is required in body.
 *
 * Body: { appId: string, throttle: number, topic?: string, guid?: string }
 */
router.post('/throttle', requireBuilder, async (req, res) => {
  const { appId, throttle, topic, guid, scope } = req.body;
  if (!appId) {
    res.status(400).json({ error: 'appId is required' });
    return;
  }
  const result = await api.applyThrottle({ appId, throttle, topic, guid, scope });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/controlplane/streams?app_id=durable&duration=1h
 * Stream processing statistics.
 * Builder-only. app_id is required.
 */
router.get('/streams', requireBuilder, async (req, res) => {
  const app_id = req.query.app_id as string;
  if (!app_id) {
    res.status(400).json({ error: 'app_id query parameter is required' });
    return;
  }
  const result = await api.getStreamStats({
    app_id,
    duration: (req.query.duration as string) || '1h',
    stream: (req.query.stream as string) || undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/controlplane/stream-messages?namespace=durable&source=worker
 * Browse stream messages with pagination, filtering, and sorting.
 * Builder-only. namespace and source are required.
 */
router.get('/stream-messages', requireBuilder, async (req, res) => {
  const namespace = req.query.namespace as string;
  const source = req.query.source as string;
  if (!namespace || !source) {
    res.status(400).json({ error: 'namespace and source query parameters are required' });
    return;
  }
  const result = await api.listStreamMessages({
    namespace,
    source,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    sort_by: (req.query.sort_by as string) || undefined,
    order: (req.query.order as 'asc' | 'desc') || undefined,
    status: (req.query.status as any) || undefined,
    stream_name: (req.query.stream_name as string) || undefined,
    msg_type: (req.query.msg_type as string) || undefined,
    topic: (req.query.topic as string) || undefined,
    workflow_name: (req.query.workflow_name as string) || undefined,
    jid: (req.query.jid as string) || undefined,
    aid: (req.query.aid as string) || undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/controlplane/subscribe
 * Start the quorum→NATS bridge for a namespace.
 * Builder-only. appId is required in body.
 */
router.post('/subscribe', requireBuilder, async (req, res) => {
  const { appId } = req.body;
  if (!appId) {
    res.status(400).json({ error: 'appId is required' });
    return;
  }
  const result = await api.subscribeMesh({ appId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
