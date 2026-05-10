# File Browser API

Browse, preview, download, share, and delete files in the storage backend (S3, MinIO, or local filesystem). All endpoints require authentication except file serving.

## Browse files

```
GET /api/file-browser/browse?prefix=screenshots/&pageSize=100
```

List files and directories at a given prefix.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prefix` | `string` | No | Directory prefix to list (e.g., `screenshots/google/`) |
| `pageSize` | `number` | No | Max results (default: 100) |
| `continuationToken` | `string` | No | Cursor token from a previous response's `nextToken` field. S3/GCS use opaque cursor strings; local storage uses numeric offsets. |

**Response 200:**

```json
{
  "files": [
    { "path": "screenshots/page.png", "size": 32698, "modified_at": "2026-05-09T21:39:42.629Z" }
  ],
  "directories": ["screenshots/google/"],
  "nextToken": null
}
```

## Get file metadata

```
GET /api/file-browser/metadata/{filePath}
```

Returns metadata for a single file. The content type is inferred from the file extension when the storage backend returns a generic type.

**Response 200:**

```json
{
  "path": "screenshots/page.png",
  "size": 32698,
  "modified_at": "2026-05-09T21:39:42.000Z",
  "content_type": "image/png"
}
```

**Response 404:** `{ "error": "File not found" }`

## Generate signed URL

```
POST /api/file-browser/signed-url
```

Generate a time-limited URL for sharing a file.

**Body:**

```json
{ "path": "screenshots/page.png", "expiresIn": 3600 }
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | File path |
| `expiresIn` | `number` | Yes | Expiry in seconds. Allowed: `3600`, `21600`, `86400`, `604800`, `2592000` |

**Response 200:**

```json
{ "url": "https://...", "expiresAt": "2026-05-10T21:39:42.000Z" }
```

## Delete file

```
DELETE /api/file-browser/delete/{filePath}
```

Permanently delete a file from storage.

**Response 200:**

```json
{ "deleted": true, "path": "screenshots/page.png" }
```

**Response 404:** `{ "error": "File not found" }`

## Download file

```
GET /api/file-browser/download/{filePath}
```

Download a file with `Content-Disposition: attachment`. Returns the file stream directly.

**Response 404:** `{ "error": "File not found" }`
