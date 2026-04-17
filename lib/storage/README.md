File storage abstraction with pluggable backends. Provides a uniform interface for reading, writing, listing, and streaming files regardless of the underlying storage provider.

Key files:
- `index.ts` — `getStorageBackend()` factory that returns the configured backend (local or S3)
- `local.ts` — Local filesystem backend using the configured base directory
- `s3.ts` — S3/MinIO backend using the AWS SDK
- `types.ts` — `StorageBackend` interface: `write`, `read`, `list`, `delete`, `getLocalPath`, `commitLocalPath`, `createReadStream`
