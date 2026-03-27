import * as path from 'path';

import { getStorageBackend } from '../../services/storage';

const MIME_MAP: Record<string, string> = {
  '.json': 'application/json', '.txt': 'text/plain', '.html': 'text/html',
  '.csv': 'text/csv', '.xml': 'application/xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml',
};

export async function writeFile(args: {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
}): Promise<{ ref: string; size: number }> {
  const buffer = args.encoding === 'base64'
    ? Buffer.from(args.content, 'base64')
    : Buffer.from(args.content, 'utf-8');
  return getStorageBackend().write(args.path, buffer);
}

export async function readFile(args: {
  path: string;
  encoding?: 'utf-8' | 'base64';
}): Promise<{ content: string; size: number; mime_type: string }> {
  const { data, size } = await getStorageBackend().read(args.path);
  const ext = path.extname(args.path).toLowerCase();
  const content = args.encoding === 'base64'
    ? data.toString('base64')
    : data.toString('utf-8');
  return {
    content,
    size,
    mime_type: MIME_MAP[ext] || 'application/octet-stream',
  };
}

export async function listFiles(args: {
  directory?: string;
  pattern?: string;
}): Promise<{ files: Array<{ path: string; size: number; modified_at: string }> }> {
  return getStorageBackend().list(args.directory, args.pattern);
}

export async function deleteFile(args: {
  path: string;
}): Promise<{ deleted: boolean }> {
  return getStorageBackend().delete(args.path);
}
