# Docs

Product documentation search and retrieval. List, search, and read Long Tail documentation.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-docs` |
| Category | Reference |
| AI required | No |
| Credential providers | — |

## Compile Hints

None.

## Tools

### list_docs

List all available documentation files with their titles.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.

### search_docs

Search across all documentation for a keyword or phrase. Returns matching files with line context.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| query | string | Yes | Search term or phrase to find in documentation |

### read_doc

Read the full content of a documentation file.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| path | string | Yes | Document path relative to docs/ (e.g. "mcp.md" or "api/tasks.md") |
