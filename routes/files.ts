import { Router } from 'express';
import path from 'path';

import { getStorageBackend } from '../services/storage';

const router = Router();

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
};

/**
 * GET /api/files/*
 * Serve files from managed file storage.
 */
router.get('/{*filePath}', async (req, res) => {
  const raw = (req.params as any).filePath;
  const filePath = Array.isArray(raw) ? raw.join('/') : raw;
  if (!filePath) {
    res.status(400).json({ error: 'File path required' });
    return;
  }

  try {
    const stream = await getStorageBackend().createReadStream(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    (stream as any).pipe(res);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

export default router;
