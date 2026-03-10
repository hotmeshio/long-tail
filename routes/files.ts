import { Router } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();

const FILE_STORAGE_DIR = process.env.LT_FILE_STORAGE_DIR || './data/files';

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
router.get('/{*filePath}', (req, res) => {
  const raw = (req.params as any).filePath;
  const filePath = Array.isArray(raw) ? raw.join('/') : raw;
  if (!filePath) {
    res.status(400).json({ error: 'File path required' });
    return;
  }

  const resolved = path.resolve(FILE_STORAGE_DIR, filePath);
  const base = path.resolve(FILE_STORAGE_DIR);

  // Path traversal guard
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=300');
  fs.createReadStream(resolved).pipe(res);
});

export default router;
