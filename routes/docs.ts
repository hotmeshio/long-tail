import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

function projectRoot(): string {
  const candidates = [
    path.join(__dirname, '..'),
    path.join(__dirname, '..', '..'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'docs'))) return dir;
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

function resolveDocPath(docPath: string): string | null {
  const root = projectRoot();
  // README.md lives at project root, everything else under docs/
  if (docPath === 'README.md') {
    const fp = path.join(root, 'README.md');
    return fs.existsSync(fp) ? fp : null;
  }
  const fp = path.join(root, 'docs', docPath);
  return fs.existsSync(fp) ? fp : null;
}

router.get('/', (_req: Request, res: Response) => {
  const root = projectRoot();
  const docs: { path: string; title: string }[] = [];

  // README first
  const readmePath = path.join(root, 'README.md');
  if (fs.existsSync(readmePath)) {
    docs.push({ path: 'README.md', title: 'Long Tail' });
  }

  docs.push(...listDocs(path.join(root, 'docs')));
  res.json({ docs });
});

// Use query param for doc path to avoid Express wildcard issues
router.get('/read', (req: Request, res: Response) => {
  const docPath = req.query.path as string;
  if (!docPath || docPath.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  const filePath = resolveDocPath(docPath);
  if (!filePath) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  res.json({ path: docPath, content });
});

export default router;
