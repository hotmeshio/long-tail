import { Router } from 'express';

import * as api from '../api/agents';
import * as subApi from '../api/agent-subscriptions';

const router = Router();

/**
 * GET /api/agents
 * List agents with optional filters.
 * Query: ?status=active&knowledge_domain=...&limit=50&offset=0
 */
router.get('/', async (req, res) => {
  const result = await api.listAgents({
    status: (req.query.status as string) || undefined,
    knowledge_domain: (req.query.knowledge_domain as string) || undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/agents/:id
 * Get a single agent by ID (includes stats).
 */
router.get('/:id', async (req, res) => {
  const result = await api.getAgent({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/agents
 * Create a new agent.
 */
router.post('/', async (req, res) => {
  const { id } = req.body;
  if (!id) {
    res.status(400).json({ error: 'id is required (kebab-case agent name, e.g. "content-triage")' });
    return;
  }
  const auth = { userId: (req as any).userId, roles: (req as any).roles };
  const result = await api.createAgent(req.body, auth);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/agents/:id
 * Update an existing agent.
 */
router.put('/:id', async (req, res) => {
  const result = await api.updateAgent({ id: req.params.id, ...req.body });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/agents/:id
 * Delete an agent.
 */
router.delete('/:id', async (req, res) => {
  const result = await api.deleteAgent({ id: req.params.id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Subscription routes (nested under agent) ─────────────────────────────────

/**
 * GET /api/agents/:agentId/subscriptions
 * List all event subscriptions for an agent.
 */
router.get('/:agentId/subscriptions', async (req, res) => {
  const result = await subApi.listSubscriptions({ agentId: req.params.agentId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/agents/:agentId/subscriptions
 * Create an event subscription for an agent.
 */
router.post('/:agentId/subscriptions', async (req, res) => {
  const { topic, reaction_type } = req.body;
  if (!topic || !reaction_type) {
    res.status(400).json({ error: 'topic and reaction_type are required' });
    return;
  }
  const result = await subApi.createSubscription({ agentId: req.params.agentId, ...req.body });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/agents/:agentId/subscriptions/:subId
 * Update an event subscription.
 */
router.put('/:agentId/subscriptions/:subId', async (req, res) => {
  const result = await subApi.updateSubscription({ id: req.params.subId, ...req.body });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/agents/:agentId/subscriptions/:subId
 * Delete an event subscription.
 */
router.delete('/:agentId/subscriptions/:subId', async (req, res) => {
  const result = await subApi.deleteSubscription({ id: req.params.subId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
