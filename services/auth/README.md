JWT authentication adapter. Handles delegation tokens, service tokens, and bot API keys for inter-service and bot-to-system authentication.

Key files:
- `delegation.ts` — Create and verify scoped, short-lived delegation tokens (JWT-based, max 1 hour TTL)
- `service-token.ts` — CRUD for long-lived service tokens: hashed storage, one-read validation by digest, expiry management
- `bot-api-key.ts` — Bot API key generation and validation: one read by digest returns the key, its scopes and the active account's current roles
- `key-digest.ts` — SHA-256 digest shared by bot keys, service tokens and OAuth secrets
