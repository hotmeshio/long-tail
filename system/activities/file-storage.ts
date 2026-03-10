import * as fs from 'fs';
import * as path from 'path';

const BASE_DIR = process.env.LT_FILE_STORAGE_DIR || './data/files';

function resolveAndValidate(filePath: string): string {
  const resolved = path.resolve(BASE_DIR, filePath);
  const base = path.resolve(BASE_DIR);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal denied: ${filePath}`);
  }
  return resolved;
}

function ensureBaseDir(): void {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }
}

export async function writeFile(args: {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
}): Promise<{ ref: string; size: number }> {
  ensureBaseDir();
  const resolved = resolveAndValidate(args.path);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const buffer = args.encoding === 'base64'
    ? Buffer.from(args.content, 'base64')
    : Buffer.from(args.content, 'utf-8');
  fs.writeFileSync(resolved, buffer);
  return { ref: args.path, size: buffer.length };
}

export async function readFile(args: {
  path: string;
  encoding?: 'utf-8' | 'base64';
}): Promise<{ content: string; size: number; mime_type: string }> {
  const resolved = resolveAndValidate(args.path);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${args.path}`);
  }
  const buffer = fs.readFileSync(resolved);
  const ext = path.extname(args.path).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.json': 'application/json', '.txt': 'text/plain', '.html': 'text/html',
    '.csv': 'text/csv', '.xml': 'application/xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
  };
  const content = args.encoding === 'base64'
    ? buffer.toString('base64')
    : buffer.toString('utf-8');
  return {
    content,
    size: buffer.length,
    mime_type: mimeMap[ext] || 'application/octet-stream',
  };
}

export async function listFiles(args: {
  directory?: string;
  pattern?: string;
}): Promise<{ files: Array<{ path: string; size: number; modified_at: string }> }> {
  ensureBaseDir();
  const dir = args.directory
    ? resolveAndValidate(args.directory)
    : path.resolve(BASE_DIR);
  if (!fs.existsSync(dir)) {
    return { files: [] };
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: Array<{ path: string; size: number; modified_at: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (args.pattern && !entry.name.match(new RegExp(args.pattern.replace(/\*/g, '.*')))) continue;
    const fullPath = path.join(dir, entry.name);
    const stat = fs.statSync(fullPath);
    const relativePath = path.relative(path.resolve(BASE_DIR), fullPath);
    files.push({
      path: relativePath,
      size: stat.size,
      modified_at: stat.mtime.toISOString(),
    });
  }
  return { files };
}

export async function deleteFile(args: {
  path: string;
}): Promise<{ deleted: boolean }> {
  const resolved = resolveAndValidate(args.path);
  if (!fs.existsSync(resolved)) {
    return { deleted: false };
  }
  fs.unlinkSync(resolved);
  return { deleted: true };
}
