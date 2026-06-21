import { Durable } from '@hotmeshio/hotmesh';

import { getPool, getConnection } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Escalation client — long-tail's service layer talks to the shared
// `public.hmsh_escalations` table exclusively through `client.escalations.*`
// (HotMesh 0.22.3). The escalation client is created off a `Durable.Client`,
// which injects `getHotMeshClient` so the escalation engine pool is shared
// with the rest of the app and torn down by `Durable.shutdown()`.
// ---------------------------------------------------------------------------

let durableClient: InstanceType<typeof Durable.Client> | null = null;

/** The raw `client.escalations` surface over `public.hmsh_escalations`. */
function rawEscalations() {
  if (!durableClient) {
    durableClient = new Durable.Client({ connection: getConnection() });
  }
  return durableClient.escalations;
}

/**
 * The escalation client, with the `lt_escalations` compatibility view ensured
 * exactly once per process. Every service function awaits this so the view is
 * present before the first read/write in any context (app, route test, or the
 * service-only test that runs `migrate()` without starting workers).
 */
export async function escalations() {
  await ensureEscalationCompatView();
  return rawEscalations();
}

let viewReady: Promise<void> | null = null;

/**
 * Replace the legacy `lt_escalations` table with a view over
 * `public.hmsh_escalations`. Idempotent and memoized per process.
 *
 * - Migrates any legacy rows into `hmsh_escalations` (no-op on a fresh DB), then
 *   RENAMES the legacy table to `lt_escalations_legacy` (a recoverable backup —
 *   never dropped here) so the view can take the `lt_escalations` name.
 * - Read-path consumers (role, agent, mcp, overview) and frozen test cleanup
 *   (`DELETE FROM lt_escalations`) continue to work unchanged against the view.
 * - The one-time conversion is serialized across concurrent containers with a
 *   dedicated Postgres advisory lock, so a multi-container deploy is safe.
 *
 * Safe to call eagerly at startup and lazily on first escalation use.
 */
export function ensureEscalationCompatView(): Promise<void> {
  if (!viewReady) viewReady = installEscalationCompatView();
  return viewReady;
}

// Dedicated advisory-lock id for the compat-view conversion. Distinct from
// migrate()'s lock (8675309) because this step runs after HotMesh engine init,
// outside the migrate() sequence.
const COMPAT_VIEW_LOCK_ID = 8675310;

async function installEscalationCompatView(): Promise<void> {
  // Force HotMesh engine init so `public.hmsh_escalations` exists before the
  // view binds to it (kvtables are deployed on first engine use).
  await rawEscalations().get('00000000-0000-0000-0000-000000000000');

  // Serialize the conversion across concurrent containers on a dedicated
  // connection. Only one process performs the migrate+rename; the rest acquire
  // the lock afterward, see the view already in place, and no-op (the DO block
  // is guarded and CREATE OR REPLACE VIEW is idempotent).
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [COMPAT_VIEW_LOCK_ID]);
    await client.query(MIGRATE_AND_RENAME_LEGACY_TABLE);
    await client.query(CREATE_COMPAT_VIEW);
    loggerRegistry.info('[escalation] lt_escalations compatibility view ensured');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [COMPAT_VIEW_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// Migrate legacy `lt_escalations` rows into `hmsh_escalations` (idempotent),
// then preserve the original table as `lt_escalations_legacy` rather than
// dropping it — the rows survive untouched for verification and rollback; a
// later explicit migration can drop the backup once the cut is confirmed. Runs
// only while `lt_escalations` is still a real table; once it is a view this
// block is skipped. Payload/envelope TEXT columns are cast to JSONB defensively
// so a malformed value can never abort the upgrade.
const MIGRATE_AND_RENAME_LEGACY_TABLE = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'lt_escalations' AND c.relkind = 'r' AND n.nspname = 'public'
  ) THEN
    CREATE OR REPLACE FUNCTION pg_temp.lt_try_jsonb(t text) RETURNS jsonb AS $fn$
      BEGIN
        IF t IS NULL OR t = '' THEN RETURN NULL; END IF;
        RETURN t::jsonb;
      EXCEPTION WHEN others THEN
        RETURN to_jsonb(t);
      END;
    $fn$ LANGUAGE plpgsql IMMUTABLE;

    INSERT INTO public.hmsh_escalations
      (id, namespace, app_id, type, subtype, description, status, priority,
       task_id, origin_id, parent_id, workflow_id, task_queue, workflow_type,
       role, assigned_to, assigned_until, claim_expires_at, resolved_at, claimed_at,
       created_by, envelope, metadata, escalation_payload, resolver_payload,
       trace_id, span_id, created_at, updated_at)
    SELECT
      id, 'hmsh', 'hmsh', type, subtype, description, status, priority,
      task_id::text, origin_id, parent_id, workflow_id, task_queue, workflow_type,
      role, assigned_to, assigned_until, assigned_until, resolved_at, claimed_at,
      created_by::text,
      pg_temp.lt_try_jsonb(envelope),
      metadata,
      pg_temp.lt_try_jsonb(escalation_payload),
      pg_temp.lt_try_jsonb(resolver_payload),
      trace_id, span_id, created_at, updated_at
    FROM public.lt_escalations
    ON CONFLICT (id) DO NOTHING;

    -- Preserve the originals as a recoverable backup (rows already migrated).
    -- If a backup already exists from a prior conversion, the current table is
    -- redundant and is dropped instead of clobbering the backup.
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'lt_escalations_legacy' AND n.nspname = 'public'
    ) THEN
      DROP TABLE public.lt_escalations CASCADE;
    ELSE
      ALTER TABLE public.lt_escalations RENAME TO lt_escalations_legacy;
    END IF;
  END IF;
END $$;`;

// `available` mirrors the legacy isEffectivelyClaimed/isAvailable heuristic so
// existing `SELECT *` consumers are unaffected; the column is additive.
const CREATE_COMPAT_VIEW = `
CREATE OR REPLACE VIEW public.lt_escalations AS
  SELECT *,
    (assigned_to IS NULL OR assigned_until IS NULL OR assigned_until <= NOW()) AS available
  FROM public.hmsh_escalations;`;
