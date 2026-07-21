# Resolver Schema Enforcement

A role's `form_schema` is an API contract, and the dashboard form is one client
of it. Escalations resolve from many directions — the dashboard, the SDK, the
CLI, webhooks that know a signal key, MCP agents, and simulated workforces —
and every one of them submits the same artifact: a resolver payload shaped by
the role's form schema and its `x-lt-bind` map. Schema enforcement makes the
server the authority on that contract: roles that opt in validate every
submitted payload at the API layer and reject violations before any state
changes.

## The contract

A form schema declares, per field:

- **presence** — membership in `required`, honoring `x-lt-showIf` (a field the
  submitter cannot see never blocks submission; conditions evaluate against
  the escalation surface plus the submitted values as `resolver.*`)
- **type** — the declared JSON Schema `type`; a number field takes `1`, and
  `"1"` is a violation
- **enum** — membership in the field's declared choices
- **bounds and patterns** — `minimum`/`maximum` (and their `x-lt-*` dynamic
  variants resolved from the escalation context), lengths, `pattern`,
  `format: email` / `format: uri`
- **checklist completion** — `x-lt-require-all` against the items resolved
  from the row's own envelope

The pass that checks these is one isomorphic module
(`shared/form-validation/`): the dashboard runs it pre-submission on the flat
form values, and the API layer runs it on the submitted nested payload by
inverting each field's `x-lt-bind` path first. One implementation on both
sides means a payload that passes the client panel passes the server gate,
and a rejection lists exactly the errors the panel would show.

## Opting a role in

Enforcement is per-role config: set `enforce_schema: true` on the role
(`PATCH /api/roles/:role`, the `update_role` MCP tool, or the dashboard role
editor). The schema validated against is resolved per escalation, most
specific first:

1. `metadata.form_schema` — a full form embedded on the row
2. the `lt_role_schemas` snapshot pinned by `metadata.schema_version`
3. the role's live (latest) `form_schema`

A role that enforces but declares no schema has no contract to enforce, and
its resolves proceed unchanged.

## The rejection shape

Every surface reports violations with one canonical body
(`types/validation.ts`), HTTP status 422:

```json
{
  "error": "resolverPayload failed schema validation (2 violations)",
  "code": "schema_validation",
  "violations": [
    { "field": "contact_email", "message": "Enter a valid email address" },
    { "field": "tier", "message": "Must be one of: free, starter, professional, enterprise" }
  ],
  "role": "intake-reviewer",
  "schemaVersion": 3
}
```

- **HTTP / routes** — the 422 response body
- **SDK** — `result.status === 422`, `result.code === 'schema_validation'`,
  full body in `result.data`; narrow with `isValidationErrorBody(result.data)`
- **MCP** (`resolve_escalation`, `claim_and_resolve`) — the tool returns the
  same JSON body with `isError: true`; `check_resolution` reports
  `schema_enforced: true` on pending escalations whose role enforces
- **CLI** — prints each violation beneath the error line
- **Dashboard** — maps `violations` into the same errors panel the
  pre-submission pass feeds

Bulk surfaces (`resolve-by-ids`, `resolve-all-or-none`) tag each violation
with its `escalationId`; all-or-none semantics extend to validation — one
failing item blocks the batch before anything resolves.

## Enforcement points

All resolve surfaces run the same gate, before any resolution side effect:

| Surface | Gate placement |
|---|---|
| `POST /escalations/:id/resolve` | after RBAC and claim-liveness checks, before path dispatch |
| `POST /escalations/resolve-by-signal-key` | after write-scope check |
| `POST /escalations/resolve-by-ids` | after write-scope check; only rows in enforcing roles load in full |
| `POST /escalations/resolve-all-or-none` | after the unsupported-path check, before password redaction |
| `POST /escalations/resolve-by-metadata` | inside the atomic statement: an enforcing target returns `validation_required` with nothing written; the validated payload re-invokes with the row id asserted, and the second pass re-checks `pending` inside the same guarded statement |
| MCP `resolve_escalation` / `claim_and_resolve` | before the resolve; `claim_and_resolve` validates before claiming so a rejected payload never strands a claim |

## Production cost model

Role schemas change on admin timescales; resolves happen on work timescales.
The gate is built so the hot path pays nothing for it:

- **The enforcing-role set** (`SELECT role FROM lt_roles WHERE enforce_schema`)
  is cached under `ROLE_ENFORCEMENT_CACHE_TTL_MS` (default 30s). Every surface
  consults the cached set first — with no enforcing roles involved, a resolve
  adds zero SQL.
- **Pinned schema snapshots** are immutable and cache indefinitely (LRU-bounded).
- **Latest schemas** cache under the same TTL.
- In-process role writes invalidate immediately; across a container fleet,
  staleness is bounded by one TTL window. Escalations that pin
  `schema_version` are immune to latest-schema staleness.

Surfaces that already load the row (by id, by signal key, all-or-none)
validate with zero additional reads beyond the cached schema. Bulk-by-ids
shares its RBAC scope-row read with the gate and loads full rows only for
enforcing targets.

## Typed consumption

Enforcement guarantees what entered the system; `parseResolverPayload`
(exported from the SDK) gives workflow code the consuming half. Declare the
payload shape once as a zod schema, derive the type from it, and parse
resolutions through it at the activity boundary:

```typescript
import { z } from 'zod';
import { parseResolverPayload } from '@longtail/sdk';

export const IntakeResolverV1Schema = z.object({
  customer: z.object({ name: z.string(), email: z.string() }),
  contract: z.object({ tier: z.enum(['starter', 'professional']), approved: z.boolean() }),
});
export type IntakeResolverV1 = z.infer<typeof IntakeResolverV1Schema>;

const intake = parseResolverPayload(IntakeResolverV1Schema, response);
intake.customer.name; // typed and runtime-checked
```

A non-conforming payload throws `ResolverPayloadTypeError` carrying the same
`{ field, message }` violation list, with the ZodError as `cause`. The
`rich-form` example (`examples/workflows/rich-form/`) shows the full pattern:
one zod schema as the single source of truth for the type, the runtime check,
and the version pin.

## Rollout pattern

1. Confirm the role's submitters send complete payloads — `check_resolution`
   returns the `form_schema` (fields, types, `x-lt-bind` paths) an agent needs
   to construct one, and flags `schema_enforced` once the role opts in.
2. Flip `enforce_schema: true` on the role.
3. Watch for 422s: each one identifies a submitter with a payload gap and
   names the exact fields. The dashboard is unaffected — its pre-submission
   pass is the same code.
