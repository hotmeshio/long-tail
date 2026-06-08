# Knowledge

Persistent knowledge store for autonomous agents. Store, retrieve, search, and accumulate JSONB documents in isolated domains.

| Property | Value |
|----------|-------|
| Server ID | `long-tail-knowledge` |
| Category | Data |
| AI required | No |
| Credential providers | — |

## Compile Hints

store_knowledge: domain (string), key (string), data (object — MUST be JSON object, never string). Upserts by domain+key. search_knowledge uses JSONB containment (@>). append_knowledge adds to arrays without replacing. list_domains returns all domains with counts.

## Tools

### store_knowledge

Store a value in a 3-level additive hierarchy: domain > key > field. Upserts by domain+key — fields accumulate across calls. Same domain+key+field overwrites that field.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| domain | string | Yes | Top level — groups entries by namespace (e.g. "screenshots", "config") |
| key | string | Yes | Second level — unique identifier within domain (e.g. "homepage") |
| data | any | Yes | The value to store. Any type when field is provided; must be an object when field is omitted. |
| field | string | No | Third level (leaf) — names a specific field. Different fields accumulate; same field overwrites. |
| tags | string[] | No | Categorization tags (unioned on upsert) |

### get_knowledge

Retrieve a single knowledge entry by domain and key.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| domain | string | Yes | Knowledge domain |
| key | string | Yes | Document key |

### search_knowledge

Search knowledge entries using JSONB containment queries. The query object matches entries whose data contains the specified key-value pairs.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| domain | string | Yes | Knowledge domain to search |
| query | object | Yes | JSONB containment query |
| tags | string[] | No | Filter by tags |
| limit | number | No | Max results (default 50) |

### list_knowledge

List knowledge entries in a domain, optionally filtered by tags. Returns most recently updated first.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| domain | string | Yes | Knowledge domain |
| tags | string[] | No | Filter by tags |
| limit | number | No | Max results (default 50) |
| offset | number | No | Pagination offset |

### delete_knowledge

Delete a knowledge entry by domain and key.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| domain | string | Yes | Knowledge domain |
| key | string | Yes | Document key to delete |

### list_domains

List all knowledge domains with entry counts and last-updated timestamps.

| | |
|---|---|
| Read-safe | Yes |

**Parameters:** None.

### append_knowledge

Append a value to an array field within a knowledge entry. Creates the entry and array if they do not exist.

| | |
|---|---|
| Read-safe | No |

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| domain | string | Yes | Knowledge domain |
| key | string | Yes | Document key |
| path | string | Yes | JSONB path to array field |
| value | any | Yes | Value to append to the array |
