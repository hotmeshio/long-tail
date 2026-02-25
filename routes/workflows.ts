import { Router } from 'express';
import { Durable } from '@hotmeshio/hotmesh';

import {
  createClient,
  LT_REVIEW_ORCH_QUEUE,
  LT_VERIFY_ORCH_QUEUE,
} from '../workers';
import * as exportService from '../services/export';
import * as configService from '../services/config';
import { ltConfig } from '../modules/ltconfig';
import type { LTEnvelope } from '../types';

const router = Router();

// ── Workflow configuration ────────────────────────────────────────────────────

/**
 * GET /api/workflows/config
 * List all workflow configurations.
 */
router.get('/config', async (_req, res) => {
  try {
    const configs = await configService.listWorkflowConfigs();
    res.json({ workflows: configs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflows/:type/config
 * Get a single workflow configuration.
 */
router.get('/:type/config', async (req, res) => {
  try {
    const config = await configService.getWorkflowConfig(req.params.type);
    if (!config) {
      res.status(404).json({ error: 'Workflow config not found' });
      return;
    }
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/workflows/:type/config
 * Create or replace a workflow configuration.
 */
router.put('/:type/config', async (req, res) => {
  try {
    const config = await configService.upsertWorkflowConfig({
      workflow_type: req.params.type,
      is_lt: req.body.is_lt ?? true,
      is_container: req.body.is_container ?? false,
      task_queue: req.body.task_queue ?? null,
      default_role: req.body.default_role ?? 'reviewer',
      default_modality: req.body.default_modality ?? 'portal',
      description: req.body.description ?? null,
      roles: req.body.roles ?? [],
      lifecycle: req.body.lifecycle ?? { onBefore: [], onAfter: [] },
      consumes: req.body.consumes ?? [],
    });
    ltConfig.invalidate();
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/workflows/:type/config
 * Delete a workflow configuration and all sub-entities (cascade).
 */
router.delete('/:type/config', async (req, res) => {
  try {
    const deleted = await configService.deleteWorkflowConfig(req.params.type);
    if (!deleted) {
      res.status(404).json({ error: 'Workflow config not found' });
      return;
    }
    ltConfig.invalidate();
    res.json({ deleted: true, workflow_type: req.params.type });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workflow execution ────────────────────────────────────────────────────────

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
    const workflowId = `review-orch-${contentId}-${Durable.guid()}`;

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
    const workflowId = `verify-orch-${documentId}-${Durable.guid()}`;

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

/**
 * GET /api/workflows/:workflowId/export
 * Convenience alias — delegates to the export service.
 * Prefer the dedicated `/api/workflow-states/:workflowId` endpoint
 * which supports allow/block facet filtering.
 *
 * Query: ?taskQueue=<queue>&workflowName=<name>
 */
router.get('/:workflowId/export', async (req, res) => {
  try {
    const taskQueue = (req.query.taskQueue as string) || LT_REVIEW_ORCH_QUEUE;
    const workflowName = (req.query.workflowName as string) || 'reviewContentOrchestrator';

    const exported = await exportService.exportWorkflow(
      req.params.workflowId,
      taskQueue,
      workflowName,
    );
    res.json(exported);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
