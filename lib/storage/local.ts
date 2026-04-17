import * as fs from 'fs';
import * as path from 'path';

import type { StorageBackend } from './types';

const BASE_DIR = process.env.LT_FILE_STORAGE_DIR || './data/files';

function resolveAndValidate(filePath: string): string {
  const relative = filePath.replace(/^\/+/, '');
  const resolved = path.resolve(BASE_DIR, relative);
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

export class LocalStorageBackend implements StorageBackend {
  async write(key: string, data: Buffer): Promise<{ ref: string; size: number }> {
    ensureBaseDir();
    const resolved = resolveAndValidate(key);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, data);
    return { ref: key, size: data.length };
  }

  async read(key: string): Promise<{ data: Buffer; size: number }> {
    const resolved = resolveAndValidate(key);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${key}`);
    }
    const data = fs.readFileSync(resolved);
    return { data, size: data.length };
  }

  async list(prefix?: string, pattern?: string): Promise<{
    files: Array<{ path: string; size: number; modified_at: string }>;
  }> {
    ensureBaseDir();
    const dir = prefix
      ? resolveAndValidate(prefix)
      : path.resolve(BASE_DIR);
    if (!fs.existsSync(dir)) {
      return { files: [] };
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: Array<{ path: string; size: number; modified_at: string }> = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (pattern && !entry.name.match(new RegExp(pattern.replace(/\*/g, '.*')))) continue;
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

  async delete(key: string): Promise<{ deleted: boolean }> {
    const resolved = resolveAndValidate(key);
    if (!fs.existsSync(resolved)) {
      return { deleted: false };
    }
    fs.unlinkSync(resolved);
    return { deleted: true };
  }

  async getLocalPath(key: string): Promise<string> {
    ensureBaseDir();
    const resolved = resolveAndValidate(key);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return resolved;
  }

  async commitLocalPath(_key: string, _localPath: string): Promise<{ size: number }> {
    // No-op for local backend — file is already in its final location
    const stat = fs.statSync(_localPath);
    return { size: stat.size };
  }

  async createReadStream(key: string): Promise<NodeJS.ReadableStream> {
    const resolved = resolveAndValidate(key);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${key}`);
    }
    return fs.createReadStream(resolved);
  }
}
