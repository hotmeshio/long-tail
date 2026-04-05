OAuth provider registry and token management. Handles PKCE authorization flows, encrypted token storage, and delegation token issuance for third-party service connections.

Key files:
- `index.ts` — Provider registration, token exchange, and refresh logic
- `db.ts` — Encrypted token CRUD: store, retrieve, and revoke OAuth credentials per user and provider
- `crypto.ts` — AES-based encryption and decryption for token-at-rest protection
- `state.ts` — PKCE state parameter generation and validation for authorization code flows
