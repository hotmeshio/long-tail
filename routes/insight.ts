import { Router } from 'express';

import * as api from '../api/insight';

const router = Router();

/**
 * POST /api/insight/mcp-query
 * Run a general-purpose MCP query using all available tools.
 * Body: { prompt: string, tags?: string[], wait?: boolean, direct?: boolean }
 */
router.post('/mcp-query', async (req, res) => {
  const { prompt, tags, wait, direct, context } = req.body;
  const result = await api.mcpQuery(
    { prompt, tags, wait, direct, context },
    req.auth ? { userId: req.auth.userId } : undefined,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/insight/build-workflow
 * Build a HotMesh YAML DAG directly from a natural language description.
 * The LLM reasons about tool schemas and constructs the YAML declaratively.
 * Body: { prompt: string, tags?: string[], wait?: boolean, feedback?: string, prior_yaml?: string }
 */
router.post('/build-workflow', async (req, res) => {
  const { prompt, tags, wait, feedback, prior_yaml, answers, prior_questions } = req.body;
  const result = await api.buildWorkflow(
    { prompt, tags, wait, feedback, prior_yaml, answers, prior_questions },
    req.auth ? { userId: req.auth.userId } : undefined,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/insight/build-workflow/refine
 * Refine a previously built workflow using execution feedback.
 * Body: { prompt: string, prior_yaml: string, feedback: string, tags?: string[], wait?: boolean }
 */
router.post('/build-workflow/refine', async (req, res) => {
  const { prompt, prior_yaml, feedback, tags, wait } = req.body;
  const result = await api.refineWorkflow(
    { prompt, prior_yaml, feedback, tags, wait },
    req.auth ? { userId: req.auth.userId } : undefined,
  );
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/insight/mcp-query/describe
 * Generate a workflow description and suggested tags from prompt and result.
 * Body: { prompt: string, result_title?: string, result_summary?: string }
 */
router.post('/mcp-query/describe', async (req, res) => {
  const { prompt, result_title, result_summary } = req.body;
  const result = await api.describeWorkflow({ prompt, result_title, result_summary });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
