import { Router } from 'express';

import { startMcpQuery, describeWorkflow } from '../services/insight';

const router = Router();

/**
 * POST /api/insight/mcp-query
 * Run a general-purpose MCP query using all available tools.
 * Body: { prompt: string, tags?: string[], wait?: boolean, direct?: boolean }
 */
router.post('/mcp-query', async (req, res) => {
  try {
    const { prompt, tags, wait, direct, context } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'MCP queries require an LLM API key (OPENAI_API_KEY or ANTHROPIC_API_KEY)' });
      return;
    }

    const result = await startMcpQuery({
      prompt,
      tags,
      wait,
      direct,
      context,
      userId: req.auth?.userId,
    });

    res.json(result);
  } catch (err: any) {
    if (err.message?.includes('timeout') || err.message?.includes('TIMEOUT')) {
      res.status(504).json({ error: 'MCP query timed out. Try a simpler prompt.' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/insight/mcp-query/describe
 * Generate a workflow description and suggested tags from prompt and result.
 * Body: { prompt: string, result_title?: string, result_summary?: string }
 */
router.post('/mcp-query/describe', async (req, res) => {
  try {
    const { prompt, result_title, result_summary } = req.body;
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const result = await describeWorkflow({ prompt, result_title, result_summary });
    res.json(result);
  } catch {
    res.json({ description: req.body.prompt || '', tags: [] });
  }
});

export default router;
