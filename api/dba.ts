import * as dbaService from '../services/dba';
import type { LTApiResult } from '../types/sdk';

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

export async function deploy(): Promise<LTApiResult> {
  try {
    await dbaService.deploy();
    return { status: 200, data: { ok: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
