# lt.files

File storage operations — browse, inspect, share, and delete files in the storage backend (S3, MinIO, or local filesystem).

## browse

List files and directories at a given prefix.

```typescript
const result = await lt.files.browse({
  prefix: 'screenshots/google/',
  pageSize: 100,
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prefix` | `string` | No | Directory prefix to list |
| `pageSize` | `number` | No | Max results (default: 100) |
| `continuationToken` | `string` | No | Pagination token |

**Returns:** `LTApiResult<{ files: FileEntry[], directories: string[], nextToken?: string }>`

## getMetadata

Get metadata for a single file. Content type is inferred from the file extension when the storage backend returns a generic type.

```typescript
const result = await lt.files.getMetadata({ filePath: 'screenshots/page.png' });
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | `string` | Yes | Path to the file |

**Returns:** `LTApiResult<{ path, size, modified_at, content_type }>`

## delete

Permanently delete a file from storage.

```typescript
const result = await lt.files.delete({ filePath: 'screenshots/page.png' });
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | `string` | Yes | Path to the file |

**Returns:** `LTApiResult<{ deleted, path }>`

## generateSignedUrl

Generate a time-limited signed URL for sharing.

```typescript
const result = await lt.files.generateSignedUrl({
  filePath: 'screenshots/page.png',
  expiresIn: 3600,
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | `string` | Yes | Path to the file |
| `expiresIn` | `number` | Yes | Expiry in seconds (`3600`, `21600`, `86400`, `604800`, `2592000`) |

**Returns:** `LTApiResult<{ url, expiresAt }>`
