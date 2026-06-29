# Role Overview (COO TAT) — work in progress

Breadcrumbs for resuming. Branch: `feat/coo-queue-stats`. Started 2026-06-28.
Full design/plan lives at `~/.claude/plans/jazzy-floating-iverson.md`; durable context
at memory `project_role_as_surface.md`.

## The idea (in one paragraph)

The **role** (`lt_roles`) is the universal pivot — at once a queue, a view, and the
RBAC boundary, and the human↔AI contact boundary whose contract is the verbs
(claim/ack/resolve), not identity. The `lt_roles` row **is** the surface: it
self-describes (title, purpose, schema, home_view). The COO overview is built on the
**one measured truth: per-unit TAT = (resolved_at − created_at) / units.** Nothing else.

## TAT-FIRST mandate (do not regress)

The user explicitly cut scope: **per-unit TAT is the only measured quantity.** Goal
rate, units-done attainment, and outcome-success ratio were over-indexed and have been
**removed**. The only legitimate target is the COO's **declared per-unit TAT**
(`lt_role_dials.target_tat_seconds`); the overview's 100% line = `target ÷ measured p50`
( >100% = faster than promised ). p50 and p99 are two views of the same measured TAT.

**Deferred (clean seams, NOT built):** quantity goals set per 1h/24h/7d/30d, the
scenario/Adapt knobs, employee-availability modeling, and upstream-flow projection.
"Solve TAT; the rest flows when we model upstream flow."

## Done & VALIDATED (backend — Phases 1–3)

Typecheck clean; 22 new unit tests + full 185-test unit suite green; executed
end-to-end on the real docker Postgres via a throwaway smoke (since deleted) — per-unit
TAT, percentiles, continuous grid, target attainment, AI-vs-human cohort, and the atomic
baseline all produced correct numbers.

Key files:
- `lib/db/schemas/014_role_overview.sql` — `lt_roles` += title/purpose/metadata_schema/
  home_view; `lt_role_dials` (role, station_key, **target_tat_seconds**); `lt_role_baselines`.
- `services/role/{sql,index,types,constants}.ts` — dials CRUD (atomic `ON CONFLICT`),
  `updateRoleConfig` (Ajv-validates metadata_schema via `system/activities/schema-exchange.ts`
  `validateSchemaDocument`), `getRoleConfig`. `ROLE_HOME_VIEWS = {queue, overview}`.
- `services/escalation/attainment-sql.ts` — `buildAttainmentSql` (THE single query;
  epoch-floor buckets, `percentile_cont`, station×bucket grid, servicer pivot + cohort),
  `ATTAINMENT_RANGES`, `ENSURE_ATTAINMENT_INDEX` (lazy, on `public.hmsh_escalations`).
- `services/escalation/attainment.ts` — `computeAttainment`, `computeServicerProfile`,
  `setBaseline` (atomic `INSERT…SELECT`), `getLatestBaseline`, `listBaselines`.
- `services/escalation/facet-sql.ts` — extracted `buildReadScopeWhere` (now reused by
  `queries.ts` searchEscalationsFaceted + listFacetKeys; single-sourced visibility SQL).
- `api/escalations/attainment.ts` — RBAC gates (read-all/global for reads & profiling;
  write-all/global for setBaseline). Routes under **`/api/roles/:role/`**
  (`attainment`, `baseline`, `baselines`) in `routes/roles.ts`; dials/config routes too.
- SDK: `roles.{getConfig,updateConfig,getDials,upsertDial,deleteDial,getAttainment,
  getServicerProfile,setBaseline,getBaseline,listBaselines}` in `sdk/index.ts`.

Tests: `tests/unit/role/dials.test.ts`, `tests/unit/escalations/attainment.test.ts`,
`tests/unit/escalations/attainment-baseline.test.ts`.

## Hard rules honored (keep honoring)

Single grouped query per call (no N+1); all aggregation in Postgres (`percentile_cont`,
epoch-floor — **no date_bin**, stays portable); read-scope folded into the same WHERE;
atomic writes only (`ON CONFLICT`, single `INSERT…SELECT` for baseline — no TOCTOU);
no magic strings; no jargon ("membrane" is a mental model only — never an identifier).

## Next steps (not started)

1. **Phase 4 — dashboard** (slimmed): `dashboard/src/` — per-unit TAT chart (x = real
   time / width = bucket duration; line vs the 100% target), now-vs-baseline overlay,
   servicer panel (AI vs human), target-TAT dial editor, role directory + `home_view`
   routing. Bespoke SVG (no chart lib), no cards, Socket.IO invalidation (no polling).
   **No Adapt/scenario panel.**
2. **Phase 5 — print-farm exemplar + HTTP integration test**: seed print-farm roles with
   `target_tat_seconds` dials + `home_view='overview'`; `tests/integration/role-overview.test.ts`
   through the HTTP client. Needs a container rebuild (`docker compose up -d --build`) since
   the running container predates this code — ASK before the full reset (`down -v` + `up --build`).

## Resume checklist

- `git checkout feat/coo-queue-stats`
- Read this file + memory `project_role_as_surface.md` + the plan file.
- `npx tsc --build tsconfig.json && npx vitest run tests/unit` should be green.
- Migration 014 was already applied to the dev DB during validation; a fresh
  `docker compose down -v && up --build` re-applies it cleanly.
