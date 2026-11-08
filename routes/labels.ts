import { Router } from '../lib/http';

import * as api from '../api/labels';
import { requireRoleManager } from '../modules/auth';
import type { Response } from '../lib/http';
import type { LTApiResult } from '../types/sdk';

const router = Router();

/** An issue result: PDF and ZPL as files, a sheet as JSON. Codes are never cached. */
function sendIssued(res: Response, result: LTApiResult): void {
  res.set('Cache-Control', 'no-store');
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const { pdf, zpl, ...rest } = result.data;
  res.set('X-LT-Label-Job', rest.job.id);
  if (rest.warnings?.length) res.set('X-LT-Label-Warnings', String(rest.warnings.length));
  if (pdf) {
    res.type('application/pdf').set('Content-Disposition', `attachment; filename="labels-${rest.job.id}.pdf"`).send(Buffer.from(pdf));
    return;
  }
  if (zpl) {
    res.type('application/vnd.zebra-zpl').set('Content-Disposition', `attachment; filename="labels-${rest.job.id}.zpl"`).send(zpl);
    return;
  }
  res.json(rest);
}

// ── Templates ─────────────────────────────────────────────────────────────

/** GET /api/labels/templates?scheme=14 */
router.get('/templates', async (req, res) => {
  const scheme = req.query.scheme ? Number(req.query.scheme) : undefined;
  const result = await api.listLabelTemplates({ scheme });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/** GET /api/labels/templates/:name */
router.get('/templates/:name', async (req, res) => {
  const result = await api.getLabelTemplate({ name: String(req.params.name) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/** PUT /api/labels/templates/:name — body is the template; `expected_revision` guards a concurrent edit. */
router.put('/templates/:name', requireRoleManager, async (req, res) => {
  const result = await api.upsertLabelTemplate({ ...(req.body || {}), name: String(req.params.name) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/** DELETE /api/labels/templates/:name */
router.delete('/templates/:name', requireRoleManager, async (req, res) => {
  const result = await api.deleteLabelTemplate({ name: String(req.params.name) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/** GET /api/labels/media — presets and the default media. */
router.get('/media', async (_req, res) => {
  const result = await api.listLabelMedia();
  res.status(result.status).json(result.data);
});

/** GET /api/labels/transports — registered printer transports. */
router.get('/transports', async (_req, res) => {
  const result = await api.listLabelTransports();
  res.status(result.status).json(result.data);
});

// ── Print ─────────────────────────────────────────────────────────────────

/** POST /api/labels/preview — { template, source, layout? }. Sensitive templates come back masked. */
router.post('/preview', async (req, res) => {
  const { template, source, layout } = req.body || {};
  const result = await api.previewLabels({ template, source, layout }, req.auth!);
  res.set('Cache-Control', 'no-store');
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/labels/issue — { template, source, layout?, output, confirm?, idempotencyKey?, destination? }.
 * output: sheet (JSON), pdf, zpl, or transport:<name>.
 */
router.post('/issue', async (req, res) => {
  const { template, source, layout, output, confirm, idempotencyKey, destination, only } = req.body || {};
  sendIssued(res, await api.issueLabels({ template, source, layout, output, confirm, idempotencyKey, destination, only }, req.auth!));
});

/** POST /api/labels/badges/reissue — { userId, template, layout?, output, confirm }. */
router.post('/badges/reissue', async (req, res) => {
  const { userId, template, layout, output, confirm } = req.body || {};
  sendIssued(res, await api.reissueBadge({ userId, template, layout, output, confirm }, req.auth!));
});

// ── History ───────────────────────────────────────────────────────────────

/** GET /api/labels/jobs?template=&subjectUserId=&limit=&offset= */
router.get('/jobs', async (req, res) => {
  const result = await api.listLabelJobs({
    template: req.query.template as string | undefined,
    subjectUserId: req.query.subjectUserId as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/** GET /api/labels/jobs/:id */
router.get('/jobs/:id', async (req, res) => {
  const result = await api.getLabelJob({ id: String(req.params.id) }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

/** POST /api/labels/jobs/:id/reprint — { indices?, output, layout?, confirm? } */
router.post('/jobs/:id/reprint', async (req, res) => {
  const { indices, output, layout, confirm } = req.body || {};
  sendIssued(res, await api.reprintLabelJob({ id: String(req.params.id), indices, output, layout, confirm }, req.auth!));
});

export default router;
