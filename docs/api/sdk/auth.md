# lt.auth

Authenticate users and obtain JWT tokens.

## login

Authenticate a user by username and password.

Verifies credentials against the user store and returns a signed JWT with the user's roles and highest privilege level. The token is valid for 24 hours.

```typescript
const result = await lt.auth.login({
  username: 'jane.doe',
  password: 's3cret',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | `string` | Yes | Login identifier (external_id) |
| `password` | `string` | Yes | Plaintext password |

**Returns:** `LTApiResult<{ token, user: { id, external_id, display_name, roles } }>` -- returns 401 if credentials are invalid.

**Auth:** Not required
