# Identity and Access Management

Every Long Tail workflow executes with identity context. An activity always knows who started the work, whose permissions govern it, and what credentials are available. This is not optional — identity propagates automatically through the durable execution engine.

This document covers the IAM model, how identity flows through the system, and how to configure it for your own workflows.

## Three Identity Dimensions

Each workflow execution carries three pieces of identity:

**Initiator** — the human or cron job that triggered the workflow. Stored as `initiated_by` (a UUID from `lt_users`) on the task record. This never changes, even if the workflow delegates execution to a service account.

**Principal** — the identity the workflow runs as. Usually the initiator, but can be a service account if the workflow is configured with `execute_as` or the request includes an override. The principal determines RBAC permissions and credential access.

**Credentials** — OAuth tokens and API keys available to the principal. Resolved at runtime through a cascade: principal's stored credentials, then the initiating user's credentials, then system environment variables.

## Work-Surface Scope

Identity says *who* a principal is. Work-surface scope says *what* that principal sees and does within a role's queue. It is the fourth axis, orthogonal to initiator, principal, and credentials.

A role is a task queue with four verbs — **search**, **claim**, **ack** (resolve), **delete** (cancel). A `member` grant carries two scope axes stored on `lt_user_roles` that set the breadth of those verbs:

- `read_scope` (`self` | `all`, default `all`) — governs **search**: which escalations the member sees. `self` = items assigned to the member (`assigned_to = user`); `all` = the whole role queue.
- `write_scope` (`none` | `self` | `all`, default `all`) — governs **claim / ack / delete**: which escalations the member may act on. `none` = read-only.

The constraint is **write ⊆ read** — you cannot act on what you cannot see — so `write_scope=all` requires `read_scope=all`. `admin` and `superadmin` ignore scope and always act on the whole queue. The default `all`/`all` is the full-queue worker.

The five member profiles:

| read_scope | write_scope | Profile |
|-----------|------------|---------|
| `all` | `all` | Full worker — search and act on the whole queue (default) |
| `all` | `self` | See the whole queue, act only on own items (e.g. a chat-style room) |
| `self` | `self` | Own items only — a one-time user filling in their pre-assigned form |
| `all` | `none` | Read-only observer / auditor of the queue |
| `self` | `none` | Read-only view of one's own items |

### One-Time Users

Scope makes limited-surface users first-class. A workflow assigns an escalation to a named person — a pre-claim, setting `assigned_to` to that user — and provisions them as a `member` with `read_scope=self` and `write_scope=self`. They see and act on exactly that one item: a just-in-time form surface scoped by RBAC, with no access to the rest of the queue and no direct table access. A follow-up or update is simply another workflow firing another escalation to that same person. Because `self` scope keys off durable `assigned_to` (independent of the soft-lock claim TTL), the assignment persists until the workflow resolves it.

See the [Roles API](api/http/roles.md#work-surface-scope) for the assignment contract and [roles.md](hitl/roles.md#role-based-routing) in the HITL guide for the workflow-side flow.

## Personas

A persona is a named bundle of roles with a per-role **relationship** scope — shorthand for "add this user to these roles with these scoped privileges." Assigning a persona performs the equivalent of adding the user to each linked role at the linked scope; because each role carries its own pins, list schema, and form schema, one assignment composes the member's entire dashboard surface. Personas are a suggestion, the same way a `default_pins` entry is: admins can always hand-tune memberships per user through the existing users/roles surfaces, and the persona is the repeatable 95% path.

The relationship names a point on the member scope lattice (a persona grant is always `type=member`):

| relationship | read_scope | write_scope | Grants |
|--------------|-----------|-------------|--------|
| `write-all` | `all` | `all` | Full worker — claim, resolve, submit forms |
| `write-self` | `all` | `self` | Sees the whole queue, acts only on own assignments |
| `read-all` | `all` | `none` | Observer — sees the pond, the pins, the counts; cannot act |

`write-none` is accepted everywhere as a synonym for `read-all`.

### Membership stays the source of truth

Personas are not a second authorization path. Assignment fans out to ordinary `lt_user_roles` rows; every RBAC query reads memberships exactly as before. The persona record explains *why* the memberships exist:

- **Provenance.** Each membership carries `granted_by_persona` — the persona sustaining it, or null for a direct grant. Unassigning a persona removes only the rows it sustains. A row a sibling persona still grants is re-homed to that persona instead of being removed. A direct role-add on a persona-sustained row takes the row over (provenance flips to direct), so a later unassign never removes a membership an admin set by hand.
- **Highest allowance wins.** A user holding several personas (or a direct grant) gets the union per role — the membership row stores the highest scope any grantor supplies. Direct grants are only ever raised toward the persona union, never lowered.
- **Overlay on re-assign.** Assignment is idempotent: re-assigning a persona reconciles the user's memberships against the persona's *current* role links, so "apply and reapply" is one call. Editing a persona's links (or its link relationships) reconciles every current holder in the same transaction.
- **Deletion is exact.** Deleting a persona removes the memberships it sustains (re-homing rows a sibling persona still grants) before the persona row goes away; direct grants are untouched.

### Declaring personas

Personas are managed three equivalent ways — dashboard (**Admin → Personas**, visible to admins, superadmins, and engineers, the same audience that manages roles and users), API/SDK, and a declarative seed pass that lives in git beside the role declarations:

```typescript
await lt.personas.seed([
  {
    key: 'production-manager',
    title: 'Production Manager',
    description: 'Runs the pipeline: works design and review, watches print and the fleet.',
    roles: [
      { role: 'design', relationship: 'write-all' },
      { role: 'review', relationship: 'write-all' },
      { role: 'print', relationship: 'read-all' },
      { role: 'fleet-servicer', relationship: 'read-all' },
    ],
  },
]);
```

The seed is idempotent and authoritative per spec: title/description are overlaid, role links are synced (links absent from the spec are pruned), linked roles are ensured as FK targets, and every current holder is reconciled — re-running the seed after editing a spec re-applies it to everyone holding the persona.

HTTP surface: `GET/POST /api/personas`, `GET/PATCH/DELETE /api/personas/:key`, `PUT/DELETE /api/personas/:key/roles/:role`, `POST /api/personas/seed`, and per-user `GET/POST /api/users/:id/personas` plus `DELETE /api/users/:id/personas/:key`. `GET /api/users/:id/personas` returns the personas held and the composed role/scope map (each row naming its sustaining persona, or null for a direct grant) — the profile-page view. The same operations exist as `lt.personas.*` in the SDK, `ltc personas` in the CLI, and `*_persona` tools on the `long-tail-admin` MCP server.

### Enforcement

Scope folds into the SQL, so it is atomic with no TOCTOU window. Read scope becomes part of the escalation search query — a member sees a row when `role ∈ allRoles OR (role ∈ selfRoles AND assigned_to = me)`. Write scope folds into the atomic resolve-by-metadata query and gates the by-id claim/resolve/cancel paths. `assigned_to` is indexed, so `self` scope scales to large queues.

## Workflow Types and IAM

Long Tail has three workflow types (see the [Workflows Guide](workflows.md#three-workflow-types) for full details). IAM applies to all three:

**Durable workflows** are the baseline. Every workflow registered with HotMesh is durable: checkpointed to Postgres, restartable after crashes, with full IAM context. If an activity throws, the workflow fails.

**Certified workflows** add the interceptor. The interceptor wraps every execution so that failures escalate to a human reviewer instead of throwing. A certified workflow has an entry in `lt_config_workflows` with `certified: true` that defines its escalation defaults, invocation roles, and optional `execute_as` service account. It gets never-fail guarantees — when an LLM call returns garbage or an API is down, the workflow pauses and creates a human task rather than dying.

**Pipeline workflows** are compiled deterministic workflows that execute tool calls without an LLM. They inherit the IAM context of the invoking workflow — the principal, credentials, and trace lineage all propagate through the YAML DAG execution.

Any durable workflow can be promoted through the Workflow Registry in the dashboard: registering creates the config entry (invocation + schemas), and the Certify checkbox turns on the interceptor. Unchecking Certify demotes to registered and keeps the config; unregistering deletes it. The workflow code does not change.

## Service Accounts

A service account is a non-human principal — a row in `lt_users` with `account_type = 'bot'`. Service accounts have their own roles, scopes, and stored credentials, identical to human users in every functional respect. The `account_type` field exists for audit segmentation, not authorization.

Service accounts authenticate with API keys prefixed `lt_bot_`. The keys are bcrypt-hashed at rest and validated by the same auth adapter that handles human JWTs. Once authenticated, the request is indistinguishable from a human request.

### When to use a service account

Use `execute_as` when a workflow needs permissions or credentials that differ from the invoking user's. A nightly analytics job might run as a `data-bot` service account that holds a read-only database credential. A CI pipeline might invoke workflows through a `ci-bot` with the `engineer` role.

Two ways to set `execute_as`:

1. **Workflow config** — set `execute_as` in `lt_config_workflows`. Every invocation of that workflow runs as the specified service account.
2. **Per-request override** — pass `executeAs` in the invocation payload. Requires admin or superadmin role.

In both cases, the original invoker is preserved in `initiated_by`. The audit trail always shows both who asked and who executed.

### Lifecycle

```bash
# Create a service account (admin-only)
POST /api/bot-accounts
{ "name": "data-bot", "description": "Nightly analytics" }

# Assign roles
POST /api/bot-accounts/:id/roles
{ "role": "engineer", "type": "member" }

# Generate an API key (returned once, not retrievable later)
POST /api/bot-accounts/:id/api-keys
{ "name": "production" }
# → { "id": "...", "rawKey": "lt_bot_a1b2c3..." }

# Authenticate
curl -H "Authorization: Bearer lt_bot_a1b2c3..." \
  http://localhost:3000/api/workflows/mcpQuery/invoke \
  -d '{"prompt": "Check system health"}'
```

## Identity Flow

Identity propagates automatically from HTTP request to activity:

```
HTTP request (JWT or lt_bot_ key)
  → req.auth.userId
    → LTEnvelope.lt.userId / lt.executeAs
      → Interceptor resolves ToolContext from DB (roles, scopes)
        → Activity interceptor injects principal into argumentMetadata
          → getToolContext() / getActivityIdentity() in any activity
```

Inside an activity, call `getActivityIdentity()` to access identity and credentials:

```typescript
import { getActivityIdentity } from '../services/iam/activity';

export async function fetchData(input: { query: string }) {
  const identity = getActivityIdentity();

  // Who is executing
  identity.principal.id;          // UUID
  identity.principal.type;        // 'user' | 'bot'
  identity.principal.roles;       // ['engineer', 'admin']

  // Who originally initiated (when execute_as is used)
  identity.initiatingPrincipal;   // the human who triggered the workflow

  // Credential exchange
  const token = await identity.getCredential('anthropic');
}
```

The `basicEcho` example workflow (`examples/workflows/basic-echo/`) demonstrates all three access patterns: `getActivityIdentity()`, `getToolContext()`, and raw `Durable.activity.getContext()`. Use it to verify IAM propagation in your environment.

## Credential Exchange

Activities resolve credentials at runtime through a cascade:

1. **Executing principal's stored credential** — looks up the service account's or user's encrypted OAuth token in `lt_oauth_tokens`. Expired tokens with refresh tokens are refreshed automatically.
2. **Initiating principal's credential** — if `execute_as` is active and the service account lacks the credential, falls back to the human invoker's stored token.
3. **System environment variable** — checks well-known env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.).

If none resolve, `getCredential()` throws `MissingCredentialError`. The credential source is tracked (`user`, `bot`, or `system`) for billing and audit.

```typescript
// A service account workflow that needs the invoking user's Gmail token
const identity = getActivityIdentity();
const gmailToken = await identity.getCredential('google');
// Cascade: bot's token → human invoker's token → env var → MissingCredentialError
```

## Ephemeral Credentials

When a workflow needs a credential it does not have — a password, an API key, a one-time token — it escalates to a human. The human provides the value through a form. The challenge: that value must reach the tool that needs it without being logged, stored in workflow state, or exposed to the LLM.

Long Tail solves this with ephemeral credential tokens.

### How it works

1. **Escalation creates a form.** The MCP tool (typically `escalate_and_wait`) includes a `form_schema` with fields marked `format: "password"`. The dashboard renders these as masked password inputs.

2. **User submits the form.** The resolve endpoint (`POST /api/escalations/:id/resolve`) intercepts password fields before signaling the workflow. Each plaintext value is encrypted with AES-256-GCM and stored in `lt_ephemeral_credentials` with a 15-minute TTL. The plaintext is replaced with an opaque token: `eph:v1:password:<uuid>`.

3. **The workflow receives only tokens.** The signal payload contains `eph:v1:...` strings where passwords were. The LLM sees these tokens if it inspects the resolver data — but they are meaningless without exchange.

4. **Exchange happens at dispatch.** When a tool is about to be called, `exchangeTokensInArgs()` walks the argument tree. Every `eph:v1:` string is exchanged atomically: the row's `use_count` increments, the encrypted value is decrypted, and the plaintext is returned. This happens in the activity callback — the latest possible moment before the external API call.

5. **Tokens expire.** After 15 minutes or after exhausting `max_uses`, the row is deleted. No plaintext persists in the database.

### Token lifecycle

| Property | Value |
|---|---|
| Format | `eph:v1:<label>:<uuid>` |
| Encryption | AES-256-GCM |
| Default TTL | 900 seconds (15 minutes) |
| Max uses | Unlimited by default, configurable |
| Exchange tracking | `use_count` incremented atomically on each exchange |
| Storage | `lt_ephemeral_credentials` table, encrypted at rest |

### Exchange points

Tokens are exchanged in three places, all at the final moment before tool dispatch:

- **MCP tool executor** — dynamic LLM-driven tool calls in mcpQuery workflows
- **Triage tool executor** — tool calls during mcpTriage remediation
- **YAML workflow workers** — compiled pipeline tool calls (both DB and MCP server tools)

If a token is expired or exhausted, the opaque string passes through unchanged. The receiving tool will reject it as an unrecognized credential — a safe failure mode.

### MissingCredentialError

When an activity calls `getCredential('anthropic')` and no credential exists in the cascade (principal → initiator → env var), `MissingCredentialError` is thrown. The interceptor catches this and creates a credential-focused escalation with `category: 'missing_credential'`. The escalation form can include a password field so the human provides the credential ephemerally, without it being stored permanently.

## Dashboard

The dashboard surfaces IAM across four pages:

**Workflow Registry** (`/workflows/registry`) — lists all discovered workflows. Certified workflows display a ShieldCheck badge in accent blue; pipeline workflows display a Wand2 icon in purple; durable workflows show the standard Workflow icon. Use ShieldPlus to certify a registered workflow, the Certify checkbox on the detail page to promote or demote, and ShieldOff to unregister.

**Accounts** (`/admin/users`) — unified management for User Accounts and Service Accounts via tab toggle. Create service accounts, assign roles, generate API keys. The key generation flow displays the raw key once; it cannot be retrieved after dismissal.

**Invoke Workflow** (`/workflows/start`) — all invocable workflows in a single list with visual tier distinction. Certified workflows show the green shield; durable workflows show the standard icon. Both support Start Now and Schedule (cron).

**Connections** (`/credentials`) — each user manages their OAuth provider connections. Status, credential type, and expiry are visible. Users connect or revoke providers here.

## Audit Trail

Every task record carries three audit columns:

| Column | Type | Description |
|---|---|---|
| `initiated_by` | UUID | The human or cron that started the workflow chain |
| `principal_type` | `user` \| `bot` | Type of the executing principal |
| `executing_as` | string | Service account `external_id` when `execute_as` is active |

These columns enable queries like "show all workflows a service account executed" or "find every workflow initiated by user X but executed by bot Y."

The MCP client also emits debug-level audit logs for every tool invocation:

```
[lt-mcp:audit] fetchJson on long-tail-http-fetch by user:a1b2c3d4
[lt-mcp:audit] run_query on long-tail-db by bot:e5f6g7h8
```

## Security Model

| Credential | Scope | Lifetime | Revocation |
|---|---|---|---|
| User JWT | Full API (RBAC-scoped) | 24 hours | Logout / expiry |
| Bot API key | Full API (RBAC-scoped) | Until revoked | Admin deletes key |
| Delegation token | Specific scopes | 5 min (max 1 hr) | Expires naturally |
| OAuth token | Provider scopes | Provider-set | User revokes in Connections |

Service accounts inherit the same RBAC constraints as human users. A service account with the `member` role cannot access admin endpoints. A service account without `engineer` cannot invoke workflows gated by `invocation_roles`.

The `execute_as` override requires admin role. There is no way for a non-admin to impersonate a service account through the API.

## Key Files

| Layer | Path |
|---|---|
| Types | `types/tool-context.ts` |
| Context propagation | `services/iam/context.ts` |
| Identity resolution | `services/iam/resolve.ts` |
| Activity identity | `services/iam/activity.ts` |
| Credential cascade | `services/iam/credentials.ts` |
| Service account management | `services/iam/bots.ts` |
| Admin API | `routes/bot-accounts.ts` |
| Example workflow | `examples/workflows/basic-echo/` |
| Schema (accounts) | `services/db/schemas/008_bot_accounts.sql` |
| Schema (audit) | `services/db/schemas/009_audit_trail.sql` |
| Schema (execute_as) | `services/db/schemas/013_execute_as.sql` |
