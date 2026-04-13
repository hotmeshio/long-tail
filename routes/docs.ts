import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

function docsDir(): string {
  const candidates = [
    path.join(__dirname, '..', 'docs'),
    path.join(__dirname, '..', '..', 'docs'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

function listDocs(dir: string, prefix = ''): { path: string; title: string }[] {
  if (!fs.existsSync(dir)) return [];
  const results: { path: string; title: string }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listDocs(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
      const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
      const firstLine = content.split('\n').find(l => l.startsWith('# '));
      const title = firstLine ? firstLine.replace(/^#\s+/, '') : entry.name;
      results.push({ path: rel, title });
    }
  }
  return results;
}

router.get('/', (_req: Request, res: Response) => {
  res.json({ docs: listDocs(docsDir()) });
});

// Use query param for doc path to avoid Express wildcard issues
router.get('/read', (req: Request, res: Response) => {
  const docPath = req.query.path as string;
  if (!docPath || docPath.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  const filePath = path.join(docsDir(), docPath);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  res.json({ path: docPath, content });
});

export default router;
