import { Router } from 'express';
import { MemFlow } from '@hotmeshio/hotmesh';

import {
  createClient,
  LT_REVIEW_ORCH_QUEUE,
  LT_VERIFY_ORCH_QUEUE,
} from '../workers';
import type { LTEnvelope } from '../types';

const router = Router();

/**
 * POST /api/workflows/review-content
 * Start a new content review orchestrator workflow.
 * Body: { contentId: string, content: string, contentType?: string }
 */
router.post('/review-content', async (req, res) => {
  try {
    const { contentId, content, contentType } = req.body || {};
    if (!contentId || !content) {
      res.status(400).json({ error: 'contentId and content are required' });
      return;
    }

    const envelope: LTEnvelope = {
      data: { contentId, content, contentType },
      metadata: {},
    };

    const client = createClient();
    const workflowId = `review-orch-${contentId}-${MemFlow.guid()}`;

    const handle = await client.workflow.start({
      args: [envelope],
      taskQueue: LT_REVIEW_ORCH_QUEUE,
      workflowName: 'reviewContentOrchestrator',
      workflowId,
      expire: 86_400,
    });

    res.status(202).json({
      workflowId: handle.workflowId,
      message: 'Workflow started',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workflows/verify-document
 * Start a new document verification orchestrator workflow.
 * Body: { documentId: string }
 */
router.post('/verify-document', async (req, res) => {
  try {
    const { documentId } = req.body || {};
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }

    const envelope: LTEnvelope = {
      data: { documentId },
      metadata: {},
    };

    const client = createClient();
    const workflowId = `verify-orch-${documentId}-${MemFlow.guid()}`;

    const handle = await client.workflow.start({
      args: [envelope],
      taskQueue: LT_VERIFY_ORCH_QUEUE,
      workflowName: 'verifyDocumentOrchestrator',
      workflowId,
      expire: 86_400,
    });

    res.status(202).json({
      workflowId: handle.workflowId,
      message: 'Workflow started',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflows/:workflowId/status
 * Get the status of a running workflow.
 * Query: ?taskQueue=<queue>&workflowName=<name>
 */
router.get('/:workflowId/status', async (req, res) => {
  try {
    const taskQueue = (req.query.taskQueue as string) || LT_REVIEW_ORCH_QUEUE;
    const workflowName = (req.query.workflowName as string) || 'reviewContentOrchestrator';

    const client = createClient();
    const handle = await client.workflow.getHandle(
      taskQueue,
      workflowName,
      req.params.workflowId,
    );
    const status = await handle.status();
    res.json({ workflowId: req.params.workflowId, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflows/:workflowId/result
 * Await and return the workflow result (blocks until complete).
 * Query: ?taskQueue=<queue>&workflowName=<name>
 */
router.get('/:workflowId/result', async (req, res) => {
  try {
    const taskQueue = (req.query.taskQueue as string) || LT_REVIEW_ORCH_QUEUE;
    const workflowName = (req.query.workflowName as string) || 'reviewContentOrchestrator';

    const client = createClient();
    const handle = await client.workflow.getHandle(
      taskQueue,
      workflowName,
      req.params.workflowId,
    );
    const result = await handle.result();
    res.json({ workflowId: req.params.workflowId, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
