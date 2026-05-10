import { Router } from 'express';
import path from 'path';

import * as api from '../api/files';
import { getStorageBackend } from '../lib/storage';
import { mimeFromPath } from '../lib/storage/mime';

const router = Router();

/**
 * GET /api/file-browser/browse
 * List files and directories at a given prefix.
 * Query: ?prefix=screenshots/&pageSize=100&continuationToken=...
 */
router.get('/browse', async (req, res) => {
  const result = await api.browseFiles({
    prefix: req.query.prefix as string,
    pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : undefined,
    continuationToken: req.query.continuationToken as string,
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/file-browser/metadata/*
 * Get metadata for a single file.
 */
router.get('/metadata/{*filePath}', async (req, res) => {
  const raw = (req.params as any).filePath;
  const filePath = Array.isArray(raw) ? raw.join('/') : raw;
  if (!filePath) {
    res.status(400).json({ error: 'File path required' });
    return;
  }
  const result = await api.getFileMetadata({ filePath });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * POST /api/file-browser/signed-url
 * Generate a time-limited signed URL for sharing.
 * Body: { path, expiresIn } — expiresIn in seconds (3600, 21600, 86400, 604800, 2592000)
 */
router.post('/signed-url', async (req, res) => {
  const { path: filePath, expiresIn } = req.body;
  if (!filePath || !expiresIn) {
    res.status(400).json({ error: 'path and expiresIn are required' });
    return;
  }
  const result = await api.generateSignedUrl({
    filePath,
    expiresIn: typeof expiresIn === 'number' ? expiresIn : parseInt(expiresIn, 10),
  });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * DELETE /api/file-browser/delete/*
 * Permanently delete a file.
 */
router.delete('/delete/{*filePath}', async (req, res) => {
  const raw = (req.params as any).filePath;
  const filePath = Array.isArray(raw) ? raw.join('/') : raw;
  if (!filePath) {
    res.status(400).json({ error: 'File path required' });
    return;
  }
  const result = await api.deleteFile({ filePath });
  res.status(result.status).json(result.data ?? { error: result.error });
});

/**
 * GET /api/file-browser/download/*
 * Download a file with Content-Disposition: attachment.
 */
router.get('/download/{*filePath}', async (req, res) => {
  const raw = (req.params as any).filePath;
  const filePath = Array.isArray(raw) ? raw.join('/') : raw;
  if (!filePath) {
    res.status(400).json({ error: 'File path required' });
    return;
  }

  try {
    const stream = await getStorageBackend().createReadStream(filePath);
    const fileName = path.basename(filePath);
    const contentType = mimeFromPath(filePath);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    (stream as any).pipe(res);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

export default router;
