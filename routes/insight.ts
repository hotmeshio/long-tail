import { Router } from 'express';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../modules/config';

const router = Router();

/**
 * POST /api/insight
 * Run an AI-powered insight query against the system database.
 * Body: { question: string }
 * Returns structured analysis with title, summary, sections, metrics.
 */
router.post('/', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'question is required' });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(503).json({ error: 'Insight queries require OPENAI_API_KEY to be configured' });
      return;
    }

    const startTime = Date.now();

    const connection = { class: Postgres, options: postgres_options };
    const client = new Durable.Client({ connection });

    const workflowId = `insight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = await client.workflow.start({
      args: [{
        data: { question },
        metadata: { source: 'dashboard' },
      }],
      taskQueue: 'lt-insight',
      workflowName: 'insightQuery',
      workflowId,
    });

    const result = await handle.result<Record<string, any>>({ state: true });

    // The interceptor wraps the return in { type: 'return', data: ... }
    // but handle.result() returns the raw workflow output
    const data = (result as any)?.data || result;

    res.json({
      ...data,
      query: question,
      workflow_id: workflowId,
      duration_ms: Date.now() - startTime,
    });
  } catch (err: any) {
    if (err.message?.includes('timeout') || err.message?.includes('TIMEOUT')) {
      res.status(504).json({ error: 'Insight query timed out. Try a simpler question.' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
