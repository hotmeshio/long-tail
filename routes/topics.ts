import { Router } from 'express';

import * as api from '../api/topics';

const router = Router();

/**
 * GET /api/topics
 * List topics with optional filters.
 * Query: ?category=task&search=...&limit=50&offset=0
 */
router.get('/', async (req, res) => {
  const result = await api.listTopics({
    category: (req.query.category as string) || undefined,
    search: (req.query.search as string) || undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/topics
 * Register a new topic in the catalog.
 */
router.post('/', async (req, res) => {
  const { topic, category } = req.body;
  if (!topic || !category) {
    res.status(400).json({ error: 'topic and category are required' });
    return;
  }
  const result = await api.createTopic(req.body);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/topics/by-name/:topic
 * Get a single topic by key. Client must encodeURIComponent the topic.
 */
router.get('/by-name/:topic', async (req, res) => {
  const result = await api.getTopic({ topic: decodeURIComponent(req.params.topic) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/topics/by-name/:topic
 * Update a topic in the catalog.
 */
router.put('/by-name/:topic', async (req, res) => {
  const result = await api.updateTopic({ topic: decodeURIComponent(req.params.topic), ...req.body });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/topics/by-name/:topic
 * Delete a topic from the catalog (system topics are protected).
 */
router.delete('/by-name/:topic', async (req, res) => {
  const result = await api.deleteTopic({ topic: decodeURIComponent(req.params.topic) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
