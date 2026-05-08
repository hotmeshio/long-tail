import * as fs from 'fs';
import * as path from 'path';
import jwt from 'jsonwebtoken';

import type { StorageBackend } from './types';
import { mimeFromPath } from './mime';

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

  async listWithPrefixes(prefix?: string, pageSize?: number, continuationToken?: string): Promise<{
    files: Array<{ path: string; size: number; modified_at: string }>;
    directories: string[];
    nextToken?: string;
  }> {
    ensureBaseDir();
    const dir = prefix ? resolveAndValidate(prefix) : path.resolve(BASE_DIR);
    if (!fs.existsSync(dir)) {
      return { files: [], directories: [] };
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const limit = pageSize || 100;
    const offset = continuationToken ? parseInt(continuationToken, 10) : 0;

    const allDirs: string[] = [];
    const allFiles: Array<{ path: string; size: number; modified_at: string }> = [];

    for (const entry of entries) {
      const relativePath = path.relative(
        path.resolve(BASE_DIR),
        path.join(dir, entry.name),
      );
      if (entry.isDirectory()) {
        allDirs.push(relativePath + '/');
      } else if (entry.isFile()) {
        const stat = fs.statSync(path.join(dir, entry.name));
        allFiles.push({
          path: relativePath,
          size: stat.size,
          modified_at: stat.mtime.toISOString(),
        });
      }
    }

    // Directories first, then files — paginate the combined list
    const combined = [...allDirs.map((d) => ({ type: 'dir' as const, value: d })),
                      ...allFiles.map((f) => ({ type: 'file' as const, value: f }))];
    const page = combined.slice(offset, offset + limit);
    const hasMore = offset + limit < combined.length;

    const directories = page.filter((e) => e.type === 'dir').map((e) => e.value as string);
    const files = page.filter((e) => e.type === 'file').map((e) => e.value as { path: string; size: number; modified_at: string });

    return {
      files,
      directories,
      nextToken: hasMore ? String(offset + limit) : undefined,
    };
  }

  async getMetadata(key: string): Promise<{ size: number; modified_at: string; content_type: string }> {
    const resolved = resolveAndValidate(key);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${key}`);
    }
    const stat = fs.statSync(resolved);
    return {
      size: stat.size,
      modified_at: stat.mtime.toISOString(),
      content_type: mimeFromPath(key),
    };
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET not configured — cannot generate signed URLs');
    }
    const token = jwt.sign(
      { filePath: key.replace(/^\/+/, ''), purpose: 'file-download' },
      secret,
      { expiresIn: expiresInSeconds },
    );
    return `/api/files/${key.replace(/^\/+/, '')}?token=${token}`;
  }
}
