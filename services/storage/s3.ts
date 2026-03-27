import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

import type { StorageBackend } from './types';

const STAGING_DIR = path.join(os.tmpdir(), 'lt-staging');

export class S3StorageBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private bucketReady: Promise<void>;

  constructor() {
    const endpoint = process.env.LT_S3_ENDPOINT;
    const region = process.env.LT_S3_REGION || 'us-east-1';
    const forcePathStyle = process.env.LT_S3_FORCE_PATH_STYLE === 'true';
    this.bucket = process.env.LT_S3_BUCKET || 'long-tail-files';

    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region,
      forcePathStyle,
    };

    if (endpoint) {
      clientConfig.endpoint = endpoint;
    }

    // Explicit credentials (MinIO, HMAC keys). If absent, SDK falls through
    // to IAM role / instance metadata (standard AWS behavior).
    const accessKey = process.env.LT_S3_ACCESS_KEY;
    const secretKey = process.env.LT_S3_SECRET_KEY;
    if (accessKey && secretKey) {
      clientConfig.credentials = {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      };
    }

    this.client = new S3Client(clientConfig);
    this.bucketReady = this.ensureBucket();
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (err: any) {
        // Bucket may have been created concurrently
        if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') {
          throw err;
        }
      }
    }
  }

  async write(key: string, data: Buffer): Promise<{ ref: string; size: number }> {
    await this.bucketReady;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: normalizeKey(key),
      Body: data,
    }));
    return { ref: key, size: data.length };
  }

  async read(key: string): Promise<{ data: Buffer; size: number }> {
    await this.bucketReady;
    const resp = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: normalizeKey(key),
    }));
    const chunks: Buffer[] = [];
    for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    return { data, size: data.length };
  }

  async list(prefix?: string, pattern?: string): Promise<{
    files: Array<{ path: string; size: number; modified_at: string }>;
  }> {
    await this.bucketReady;
    const normalizedPrefix = prefix ? normalizeKey(prefix) : undefined;
    // Use Delimiter to mimic single-directory listing (like readdirSync)
    const listPrefix = normalizedPrefix ? (normalizedPrefix.endsWith('/') ? normalizedPrefix : normalizedPrefix + '/') : undefined;
    const resp = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: listPrefix,
      Delimiter: '/',
    }));
    const files: Array<{ path: string; size: number; modified_at: string }> = [];
    for (const obj of resp.Contents || []) {
      if (!obj.Key || !obj.Size) continue;
      // Extract filename from key for pattern matching
      const fileName = obj.Key.split('/').pop() || '';
      if (pattern && !fileName.match(new RegExp(pattern.replace(/\*/g, '.*')))) continue;
      files.push({
        path: obj.Key,
        size: obj.Size,
        modified_at: obj.LastModified?.toISOString() || new Date().toISOString(),
      });
    }
    return { files };
  }

  async delete(key: string): Promise<{ deleted: boolean }> {
    await this.bucketReady;
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: normalizeKey(key),
      }));
      return { deleted: true };
    } catch {
      return { deleted: false };
    }
  }

  async getLocalPath(key: string): Promise<string> {
    const localPath = path.join(STAGING_DIR, normalizeKey(key));
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return localPath;
  }

  async commitLocalPath(key: string, localPath: string): Promise<{ size: number }> {
    const data = fs.readFileSync(localPath);
    await this.write(key, data);
    // Clean up staging file
    try { fs.unlinkSync(localPath); } catch { /* ignore */ }
    return { size: data.length };
  }

  async createReadStream(key: string): Promise<NodeJS.ReadableStream> {
    await this.bucketReady;
    const resp = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: normalizeKey(key),
    }));
    return resp.Body as Readable;
  }
}

/** Strip leading slashes to create a valid S3 key; reject traversal. */
function normalizeKey(key: string): string {
  const normalized = key.replace(/^\/+/, '');
  if (normalized.includes('..')) {
    throw new Error(`Path traversal denied: ${key}`);
  }
  return normalized;
}
