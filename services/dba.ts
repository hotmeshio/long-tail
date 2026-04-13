import { DBA } from '@hotmeshio/hotmesh';
import { Client as Postgres } from 'pg';
import type { PruneOptions, PruneResult } from '@hotmeshio/hotmesh/build/types/dba';

import { postgres_options } from '../modules/config';

const APP_ID = 'durable';

/**
 * Deploy the server-side prune() Postgres function and run
 * any schema migrations (e.g. adding the `pruned_at` column).
 * Idempotent — safe to call on every startup.
 */
export async function deploy(): Promise<void> {
  const connection = { class: Postgres, options: postgres_options };
  await DBA.deploy(connection, APP_ID);
}

/**
 * Prune expired jobs, streams, and/or execution artifacts.
 *
 * - `jobs` — hard-delete expired job rows older than `expire`
 * - `streams` — hard-delete expired stream messages (engine + worker) older than `expire`
 * - `attributes` — strip execution artifacts from completed jobs
 *   (preserves jdata, udata, jmark for execution export)
 * - `entities` — allowlist: only prune these entity types
 * - `pruneTransient` — also delete jobs where entity IS NULL
 * - `keepHmark` — preserve hmark rows during stripping
 */
export async function prune(options: {
  expire?: string;
  jobs?: boolean;
  streams?: boolean;
  engineStreams?: boolean;
  engineStreamsExpire?: string;
  workerStreams?: boolean;
  workerStreamsExpire?: string;
  attributes?: boolean;
  entities?: string[];
  pruneTransient?: boolean;
  keepHmark?: boolean;
}): Promise<PruneResult> {
  const connection = { class: Postgres, options: postgres_options };
  return DBA.prune({ appId: APP_ID, connection, ...options });
}

export type { PruneOptions, PruneResult };
