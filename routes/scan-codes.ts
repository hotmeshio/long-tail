import { Router } from 'express';

import * as api from '../api/scan-codes';
import { requireAdmin } from '../modules/auth';

const router = Router();

// ── Execute ───────────────────────────────────────────────────────────────

/**
 * POST /api/scan-codes/execute
 * Execute a raw scan code (from any input source) as the calling user.
 * Every terminal state is a structured 200 outcome.
 */
router.post('/execute', async (req, res) => {
  const result = await api.executeScanCode({ code: req.body.code }, req.auth!);
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Scheme CRUD (admin) ───────────────────────────────────────────────────

/**
 * GET /api/scan-codes/schemes
 * List all scan schemes.
 */
router.get('/schemes', async (_req, res) => {
  const result = await api.listScanSchemes();
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/scan-codes/schemes/:version
 * Get one scheme with its rules.
 */
router.get('/schemes/:version', async (req, res) => {
  const result = await api.getScanScheme({ version: Number(req.params.version) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/scan-codes/schemes/:version
 * Create or replace a scan scheme. Admin only.
 */
router.put('/schemes/:version', requireAdmin, async (req, res) => {
  const result = await api.upsertScanScheme({
    version: Number(req.params.version),
    name: req.body.name,
    description: req.body.description,
    target_facet: req.body.target_facet,
    encoding: req.body.encoding,
    delimiter: req.body.delimiter,
    target_length: req.body.target_length,
    enabled: req.body.enabled,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/scan-codes/schemes/:version
 * Delete a scheme and its rules (cascade). Admin only.
 */
router.delete('/schemes/:version', requireAdmin, async (req, res) => {
  const result = await api.deleteScanScheme({ version: Number(req.params.version) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

// ── Rule CRUD (admin) ─────────────────────────────────────────────────────

/**
 * GET /api/scan-codes/schemes/:version/actions
 * List a scheme's rules.
 */
router.get('/schemes/:version/actions', async (req, res) => {
  const result = await api.listScanRules({ version: Number(req.params.version) });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/scan-codes/schemes/:version/actions/:category
 * Get one rule.
 */
router.get('/schemes/:version/actions/:category', async (req, res) => {
  const result = await api.getScanRule({
    version: Number(req.params.version),
    category: req.params.category as string,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * PUT /api/scan-codes/schemes/:version/actions/:category
 * Create or replace a rule. Admin only.
 */
router.put('/schemes/:version/actions/:category', requireAdmin, async (req, res) => {
  const result = await api.upsertScanRule({
    scheme_version: Number(req.params.version),
    category: req.params.category as string,
    name: req.body.name,
    steps: req.body.steps,
    fallback: req.body.fallback,
    enabled: req.body.enabled,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/scan-codes/schemes/:version/actions/:category
 * Delete a rule. Admin only.
 */
router.delete('/schemes/:version/actions/:category', requireAdmin, async (req, res) => {
  const result = await api.deleteScanRule({
    version: Number(req.params.version),
    category: req.params.category as string,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

export default router;
