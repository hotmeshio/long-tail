import type { StorageBackend } from './types';

export type { StorageBackend } from './types';

let _backend: StorageBackend | null = null;

/**
 * Returns the singleton storage backend.
 *
 * Backend selection (via LT_STORAGE_BACKEND env var):
 *   "local" (default) — filesystem storage under LT_FILE_STORAGE_DIR
 *   "s3"              — S3-compatible (MinIO, AWS S3, GCP Cloud Storage)
 */
export function getStorageBackend(): StorageBackend {
  if (!_backend) {
    const type = process.env.LT_STORAGE_BACKEND || 'local';
    if (type === 's3') {
      // Lazy require to avoid loading @aws-sdk when not needed
      const { S3StorageBackend } = require('./s3');
      _backend = new S3StorageBackend();
    } else {
      const { LocalStorageBackend } = require('./local');
      _backend = new LocalStorageBackend();
    }
  }
  return _backend!;
}

/** Reset the singleton (for testing). */
export function resetStorageBackend(): void {
  _backend = null;
}
