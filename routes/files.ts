import { Router } from 'express';
import jwt from 'jsonwebtoken';

import { getStorageBackend } from '../lib/storage';
import { mimeFromPath } from '../lib/storage/mime';

const router = Router();

/**
 * GET /api/files/*
 * Serve files from managed file storage.
 * Requires a signed token (?token=<jwt>) for authenticated access.
 * Use POST /api/file-browser/signed-url to generate a token.
 */
router.get('/{*filePath}', async (req, res) => {
  const raw = (req.params as any).filePath;
  const filePath = Array.isArray(raw) ? raw.join('/') : raw;
  if (!filePath) {
    res.status(400).json({ error: 'File path required' });
    return;
  }

  // Require signed token — no unauthenticated file access
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Signed token required. Use /api/file-browser/signed-url to generate one.' });
    return;
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server not configured for signed URLs' });
    return;
  }
  try {
    const decoded = jwt.verify(token, secret) as { filePath?: string; purpose?: string };
    if (decoded.purpose !== 'file-download' || decoded.filePath !== filePath.replace(/^\/+/, '')) {
      res.status(403).json({ error: 'Token does not match requested file' });
      return;
    }
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const stream = await getStorageBackend().createReadStream(filePath);
    const contentType = mimeFromPath(filePath);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    (stream as any).pipe(res);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

export default router;
