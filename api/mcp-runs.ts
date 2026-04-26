import { sanitizeAppId, quoteSchema } from '../services/hotmesh-utils';
import { buildExecution, listEntities as listEntitiesService, listJobs as listJobsService } from '../services/mcp-runs';
import type { LTApiResult } from '../types/sdk';

/**
 * List distinct entity types for an app (HotMesh namespace).
 *
 * @param input.app_id — HotMesh app ID (e.g. `"durable"`)
 * @returns `{ status: 200, data: { entities: string[] } }`
 */
export async function listEntities(input: {
  app_id: string;
}): Promise<LTApiResult> {
  try {
    if (!input.app_id) {
      return { status: 400, error: 'app_id query parameter is required' };
    }
    const entities = await listEntitiesService(input.app_id);
    return { status: 200, data: { entities } };
  } catch (err: any) {
    if (err.message?.includes('does not exist')) {
      return { status: 200, data: { entities: [] } };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * List jobs (workflow executions) for an app, with optional filters.
 *
 * @param input.app_id — HotMesh app ID
 * @param input.limit — max results
 * @param input.offset — pagination offset
 * @param input.entity — filter by entity type
 * @param input.search — full-text search
 * @param input.status — filter by job status
 * @returns `{ status: 200, data: { jobs, total } }`
 */
export async function listJobs(input: {
  app_id: string;
  limit?: number;
  offset?: number;
  entity?: string;
  search?: string;
  status?: string;
}): Promise<LTApiResult> {
  try {
    if (!input.app_id) {
      return { status: 400, error: 'app_id query parameter is required' };
    }
    const result = await listJobsService({
      rawAppId: input.app_id,
      limit: input.limit,
      offset: input.offset,
      entity: input.entity,
      search: input.search,
      status: input.status,
    });
    return { status: 200, data: result };
  } catch (err: any) {
    if (err.message?.includes('does not exist')) {
      return { status: 200, data: { jobs: [], total: 0 } };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Get the full execution history for a single job.
 *
 * Reconstructs the execution timeline from the HotMesh stream,
 * including activity calls, signals, and state transitions.
 *
 * @param input.jobId — HotMesh job (workflow) ID
 * @param input.app_id — HotMesh app ID
 * @returns `{ status: 200, data: <execution timeline> }` or 404
 */
export async function getJobExecution(input: {
  jobId: string;
  app_id: string;
}): Promise<LTApiResult> {
  try {
    if (!input.app_id) {
      return { status: 400, error: 'app_id query parameter is required' };
    }
    const appId = sanitizeAppId(input.app_id);
    const schema = quoteSchema(appId);
    const execution = await buildExecution(input.jobId, appId, schema);
    return { status: 200, data: execution };
  } catch (err: any) {
    const msg: string = err.message ?? '';
    if (err.status === 404 || msg.includes('not found') || msg.includes('does not exist')) {
      return { status: 404, error: msg };
    }
    return { status: 500, error: msg };
  }
}
