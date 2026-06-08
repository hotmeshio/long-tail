# File Storage

Managed file storage for reading, writing, listing, and deleting files.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-file-storage` |
| Category | Data |
| AI required | No |
| Credential providers | — |

## Compile Hints

None.

## Tools

### read_file

Read file content from managed storage. Returns content, size, and detected MIME type. Supports utf8 (text) or base64 encoding.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| path | string | Yes | Relative path to the file in managed storage |
| encoding | string | No | Encoding to use: utf8 or base64 (default: utf8) |

### write_file

Write content to a file in managed storage. Creates directories as needed. Returns the storage reference and size.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| path | string | Yes | Relative path for the file in managed storage |
| content | string | Yes | File content to write |
| encoding | string | No | Encoding of the content: utf8 or base64 (default: utf8) |

### list_files

List files in a storage directory. Returns file paths, sizes, and modification timestamps.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| directory | string | No | Directory path to list (default: /) |
| recursive | boolean | No | Whether to list recursively (default: false) |

### delete_file

Remove a file from managed storage.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| path | string | Yes | Relative path to the file to delete |
