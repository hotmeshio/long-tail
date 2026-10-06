import { Router } from '../lib/http';

import * as api from '../api/agents';
import * as subApi from '../api/agent-subscriptions';
import { requireBuilder } from '../modules/auth';
import { assertMayConfigureAgent, assertMayConfigureSubscription } from '../services/agent/authority';
import { InvocationError } from '../services/workflow-invocation';
import type { Response } from '../lib/http';

const router = Router();

/** Run an authority check; answer its refusal and return false when it refuses. */
async function authorized(check: () => Promise<void>, res: Response): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (err: any) {
    if (!(err instanceof InvocationError)) throw err;
    res.status(err.statusCode).json({ error: err.message });
    return false;
  }
}

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
router.post('/', requireBuilder, async (req, res) => {
  const { id } = req.body;
  if (!id) {
    res.status(400).json({ error: 'id is required (kebab-case agent name, e.g. "content-triage")' });
    return;
  }
  if (!(await authorized(() => assertMayConfigureAgent(req.auth!.userId, { ...req.body, id: undefined }), res))) return;
  const auth = { userId: (req as any).userId, roles: (req as any).roles };
  const result = await api.createAgent(req.body, auth);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/agents/:id
 * Update an existing agent.
 */
router.put('/:id', requireBuilder, async (req, res) => {
  const id = String(req.params.id);
  if (!(await authorized(() => assertMayConfigureAgent(req.auth!.userId, { ...req.body, id }), res))) return;
  const result = await api.updateAgent({ ...req.body, id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/agents/:id
 * Delete an agent.
 */
router.delete('/:id', requireBuilder, async (req, res) => {
  const result = await api.deleteAgent({ id: String(req.params.id) });
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
router.post('/:agentId/subscriptions', requireBuilder, async (req, res) => {
  const { topic, reaction_type, execute_as } = req.body;
  if (!topic || !reaction_type) {
    res.status(400).json({ error: 'topic and reaction_type are required' });
    return;
  }
  const agentId = String(req.params.agentId);
  const check = () => assertMayConfigureSubscription(req.auth!.userId, { agentId, reaction_type, execute_as });
  if (!(await authorized(check, res))) return;
  const result = await subApi.createSubscription({ ...req.body, agentId });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/agents/:agentId/subscriptions/:subId
 * Update an event subscription.
 */
router.put('/:agentId/subscriptions/:subId', requireBuilder, async (req, res) => {
  const agentId = String(req.params.agentId);
  const id = String(req.params.subId);
  const check = () => assertMayConfigureSubscription(req.auth!.userId, {
    agentId, subscriptionId: id, reaction_type: req.body?.reaction_type, execute_as: req.body?.execute_as,
  });
  if (!(await authorized(check, res))) return;
  const result = await subApi.updateSubscription({ ...req.body, id });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/agents/:agentId/subscriptions/:subId
 * Delete an event subscription.
 */
router.delete('/:agentId/subscriptions/:subId', requireBuilder, async (req, res) => {
  const result = await subApi.deleteSubscription({ id: String(req.params.subId) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
