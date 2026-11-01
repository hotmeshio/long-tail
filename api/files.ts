import { createHash } from 'crypto';
import { getStorageBackend } from '../lib/storage';
import { mimeFromPath } from '../lib/storage/mime';
import { publishFileEvent } from '../lib/events/publish';
import type { LTApiResult } from '../types/sdk';

const ALLOWED_EXPIRY = [3600, 21600, 86400, 604800, 2592000]; // 1h, 6h, 24h, 7d, 30d

export async function browseFiles(input: {
  prefix?: string;
  pageSize?: number;
  continuationToken?: string;
}): Promise<LTApiResult> {
  try {
    const result = await getStorageBackend().listWithPrefixes(
      input.prefix,
      input.pageSize || 100,
      input.continuationToken,
    );
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getFileMetadata(input: {
  filePath: string;
}): Promise<LTApiResult> {
  try {
    const metadata = await getStorageBackend().getMetadata(input.filePath);
    const contentType = (!metadata.content_type || metadata.content_type === 'application/octet-stream')
      ? mimeFromPath(input.filePath)
      : metadata.content_type;
    return { status: 200, data: { path: input.filePath, ...metadata, content_type: contentType } };
  } catch (err: any) {
    if (err.message?.includes('not found') || err.name === 'NotFound') {
      return { status: 404, error: 'File not found' };
    }
    return { status: 500, error: err.message };
  }
}

export async function deleteFile(input: {
  filePath: string;
}): Promise<LTApiResult> {
  try {
    const result = await getStorageBackend().delete(input.filePath);
    if (!result.deleted) {
      return { status: 404, error: 'File not found' };
    }
    publishFileEvent({ type: 'file.deleted', path: input.filePath });
    return { status: 200, data: { deleted: true, path: input.filePath } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * Stores the bytes with their SHA-256. A caller that names the digest it
 * expects gets 422 when the bytes received differ, and nothing is stored.
 */
export async function uploadFile(input: {
  path: string;
  buffer: Buffer;
  sha256?: string;
}): Promise<LTApiResult> {
  if (input.sha256 !== undefined && !SHA256_HEX.test(input.sha256)) {
    return { status: 400, error: 'sha256 must be 64 hex characters' };
  }
  const sha256 = createHash('sha256').update(input.buffer).digest('hex');
  if (input.sha256 && input.sha256.toLowerCase() !== sha256) {
    return {
      status: 422,
      error: 'sha256 does not match the bytes received',
      data: { error: 'sha256 does not match the bytes received', path: input.path, expected: input.sha256.toLowerCase(), actual: sha256 },
    };
  }
  try {
    const result = await getStorageBackend().write(input.path, input.buffer, { sha256 });
    const contentType = mimeFromPath(input.path);
    publishFileEvent({
      type: 'file.stored',
      path: input.path,
      size: result.size,
      mime: contentType,
    });
    return {
      status: 200,
      data: { path: input.path, size: result.size, content_type: contentType, sha256 },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function generateSignedUrl(input: {
  filePath: string;
  expiresIn: number;
}): Promise<LTApiResult> {
  if (!ALLOWED_EXPIRY.includes(input.expiresIn)) {
    return {
      status: 400,
      error: `expiresIn must be one of: ${ALLOWED_EXPIRY.join(', ')} (seconds)`,
    };
  }
  try {
    const url = await getStorageBackend().getSignedUrl(input.filePath, input.expiresIn);
    const expiresAt = new Date(Date.now() + input.expiresIn * 1000).toISOString();
    return { status: 200, data: { url, expiresAt } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
