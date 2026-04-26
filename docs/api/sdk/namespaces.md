# lt.namespaces

Manage namespaces for multi-tenant isolation.

## list

List all registered namespaces.

```typescript
const result = await lt.namespaces.list();
```

**Parameters:** None

**Returns:** `LTApiResult<{ namespaces: LTNamespace[] }>`

**Auth:** Not required

---

## register

Register a new namespace.

```typescript
const result = await lt.namespaces.register({
  name: 'acme-corp',
  description: 'Acme Corporation tenant',
  metadata: { region: 'us-east-1' },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique namespace identifier |
| `description` | `string` | No | Human-readable description |
| `metadata` | `Record<string, unknown>` | No | Arbitrary key-value metadata |

**Returns:** `LTApiResult<LTNamespace>`

**Auth:** Not required
