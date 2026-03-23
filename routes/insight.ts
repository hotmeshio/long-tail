import { Router } from 'express';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../modules/config';
import { JOB_EXPIRE_SECS, LLM_MODEL_SECONDARY } from '../modules/defaults';
import { callLLM, hasLLMApiKey } from '../services/llm';

const router = Router();

/**
 * POST /api/insight/mcp-query
 * Run a general-purpose MCP query using all available tools.
 * Body: { prompt: string, tags?: string[] }
 * Returns structured result from the mcpQuery workflow.
 */
router.post('/mcp-query', async (req, res) => {
  try {
    const { prompt, tags, wait = true, direct = false } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'MCP queries require an LLM API key (OPENAI_API_KEY or ANTHROPIC_API_KEY)' });
      return;
    }

    const startTime = Date.now();

    const connection = { class: Postgres, options: postgres_options };
    const client = new Durable.Client({ connection });

    // direct: true → mcpQuery (dynamic only, skips router)
    // direct: false → mcpQueryRouter (checks for deterministic match first)
    const wfName = direct ? 'mcpQuery' : 'mcpQueryRouter';
    const entity = direct ? 'mcpQuery' : 'mcpQueryRouter';
    const prefix = direct ? 'mcp-query-direct' : 'mcp-query';
    const workflowId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = await client.workflow.start({
      args: [{
        data: { prompt, tags },
        metadata: { source: 'dashboard' },
      }],
      taskQueue: 'long-tail-system',
      workflowName: wfName,
      workflowId,
      expire: JOB_EXPIRE_SECS,
      entity,
    } as any);

    // Async mode: return immediately with workflow ID
    if (wait === false) {
      res.json({ workflow_id: workflowId, status: 'started', prompt });
      return;
    }

    const result = await handle.result<Record<string, any>>({ state: true });
    const data = (result as any)?.data || result;

    res.json({
      ...data,
      prompt,
      workflow_id: workflowId,
      duration_ms: Date.now() - startTime,
    });
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
 * Generate a workflow description and suggested tags from the original prompt and result.
 * Used by the compile wizard to pre-fill fields with meaningful content.
 * Body: { prompt: string, result_title?: string, result_summary?: string }
 */
router.post('/mcp-query/describe', async (req, res) => {
  try {
    const { prompt, result_title, result_summary } = req.body;
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    if (!hasLLMApiKey(LLM_MODEL_SECONDARY)) {
      // Fallback: return the prompt as-is
      res.json({ description: prompt, tags: [] });
      return;
    }

    const response = await callLLM({
      model: LLM_MODEL_SECONDARY,
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `You generate concise workflow descriptions and discovery tags.

Given a user's original query and the execution result, produce:
1. A clear, reusable description of what this workflow does (not what the user asked, but what the workflow accomplishes as a reusable tool). Write it as if describing a tool in a catalog. 2-3 sentences max.
2. Discovery tags — lowercase keywords that help find this workflow when similar future queries are made.

Return ONLY a JSON object:
{ "description": "...", "tags": ["tag1", "tag2", ...] }`,
        },
        {
          role: 'user',
          content: [
            `Original query: "${prompt}"`,
            result_title ? `Result: ${result_title}` : '',
            result_summary ? `Summary: ${result_summary.slice(0, 500)}` : '',
          ].filter(Boolean).join('\n'),
        },
      ],
    });

    const raw = response.content || '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    const parsed = JSON.parse(cleaned);

    res.json({
      description: parsed.description || prompt,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    });
  } catch (err: any) {
    // Fallback gracefully
    res.json({ description: req.body.prompt || '', tags: [] });
  }
});

export default router;
