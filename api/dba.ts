import * as dbaService from '../services/dba';
import type { LTApiResult } from '../types/sdk';

/**
 * Prune stale HotMesh data from Redis.
 *
 * Selectively removes completed jobs, stream entries, engine/worker
 * streams, and search attributes. Delegates to the HotMesh DBA service.
 *
 * @param input.expire — Redis TTL expression for pruned keys
 * @param input.jobs — prune completed job hashes
 * @param input.streams — prune activity streams
 * @param input.engineStreams — prune engine consumer streams
 * @param input.engineStreamsExpire — TTL for engine stream entries
 * @param input.workerStreams — prune worker consumer streams
 * @param input.workerStreamsExpire — TTL for worker stream entries
 * @param input.attributes — prune FT.SEARCH attributes
 * @param input.entities — limit pruning to these entity types
 * @param input.pruneTransient — include transient keys
 * @param input.keepHmark — preserve hmark keys
 * @returns `{ status: 200, data: <prune result summary> }`
 */
export async function prune(input: {
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
}): Promise<LTApiResult> {
  try {
    const result = await dbaService.prune({
      expire: input.expire,
      jobs: input.jobs,
      streams: input.streams,
      engineStreams: input.engineStreams,
      engineStreamsExpire: input.engineStreamsExpire,
      workerStreams: input.workerStreams,
      workerStreamsExpire: input.workerStreamsExpire,
      attributes: input.attributes,
      entities: input.entities,
      pruneTransient: input.pruneTransient,
      keepHmark: input.keepHmark,
    });
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Deploy (or redeploy) all HotMesh workflow schemas.
 *
 * Triggers a full schema deployment across all registered entities,
 * updating the Redis execution graph. Safe to call repeatedly.
 *
 * @returns `{ status: 200, data: { ok: true } }`
 */
export async function deploy(): Promise<LTApiResult> {
  try {
    await dbaService.deploy();
    return { status: 200, data: { ok: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
