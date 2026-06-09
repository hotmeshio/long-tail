import { DBA } from '@hotmeshio/hotmesh';
import type { PruneOptions, PruneResult } from '@hotmeshio/hotmesh/build/types/dba';

import { getConnection } from '../lib/db';

/**
 * Deploy the server-side prune() Postgres function and run
 * any schema migrations (e.g. adding the `pruned_at` column).
 * Idempotent — safe to call on every startup.
 */
export async function deploy(appId: string): Promise<void> {
  await DBA.deploy(getConnection(), appId);
}

/**
 * Prune expired jobs, streams, and/or execution artifacts.
 *
 * - `appId` — HotMesh application namespace (required)
 * - `jobs` — hard-delete expired job rows older than `expire`
 * - `streams` — hard-delete expired stream messages (engine + worker) older than `expire`
 * - `attributes` — strip execution artifacts from completed jobs
 *   (preserves jdata, udata, jmark for execution export)
 * - `entities` — allowlist: only prune these entity types
 * - `pruneTransient` — also delete jobs where entity IS NULL
 * - `keepHmark` — preserve hmark rows during stripping
 */
export async function prune(options: {
  appId: string;
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
  const { appId, ...rest } = options;
  return DBA.prune({ appId, connection: getConnection(), ...rest });
}

export type { PruneOptions, PruneResult };
