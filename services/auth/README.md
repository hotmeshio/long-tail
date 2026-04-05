JWT authentication adapter. Handles delegation tokens, service tokens, and bot API keys for inter-service and bot-to-system authentication.

Key files:
- `delegation.ts` — Create and verify scoped, short-lived delegation tokens (JWT-based, max 1 hour TTL)
- `service-token.ts` — CRUD for long-lived service tokens: hashed storage, scope validation, expiry management
- `bot-api-key.ts` — Bot API key generation, hashing, and lookup for service account authentication
