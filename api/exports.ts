import * as exportService from '../services/export';
import { resolveWorkflowHandle } from '../services/task/resolve';
import type { LTApiResult } from '../types/sdk';
import type { LTExportField } from '../types';
import type { ExportMode } from '@hotmeshio/hotmesh/build/types/exporter';

/**
 * List export jobs with optional filtering, sorting, and pagination.
 *
 * @param input.limit — maximum number of jobs to return
 * @param input.offset — number of jobs to skip for pagination
 * @param input.entity — filter by entity/workflow type
 * @param input.search — free-text search across job fields
 * @param input.status — filter by job status
 * @param input.sort_by — field name to sort results by
 * @param input.order — sort direction (asc or desc)
 * @param input.registered — filter by registration status
 * @returns `{ status: 200, data: { jobs, total, ... } }` on success
 */
export async function listJobs(input: {
  limit?: number;
  offset?: number;
  entity?: string;
  search?: string;
  status?: string;
  sort_by?: string;
  order?: string;
  registered?: string;
}): Promise<LTApiResult> {
  try {
    const result = await exportService.listJobs(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Export the stored state (hash data) of a workflow.
 *
 * Resolves the workflow handle from its ID, then exports its state fields.
 * Fields can be filtered via allow/block lists. Returns 404 if the workflow
 * cannot be found or its data has expired.
 *
 * @param input.workflowId — the workflow's unique identifier
 * @param input.allow — whitelist of field names to include in the export
 * @param input.block — blacklist of field names to exclude from the export
 * @param input.values — when true, include field values (not just field names)
 * @returns `{ status: 200, data: ExportedState }` on success
 */
export async function exportWorkflowState(input: {
  workflowId: string;
  allow?: LTExportField[];
  block?: LTExportField[];
  values?: boolean;
}): Promise<LTApiResult> {
  try {
    let resolved;
    try {
      resolved = await resolveWorkflowHandle(input.workflowId);
    } catch {
      return { status: 404, error: 'Workflow not found' };
    }

    const exported = await exportService.exportWorkflow(
      input.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
      { allow: input.allow, block: input.block, values: input.values },
    );

    return { status: 200, data: exported };
  } catch (err: any) {
    const msg: string = err.message ?? '';
    if (msg.includes('not found') || msg.includes('undefined')) {
      return {
        status: 404,
        error: 'Workflow data is no longer available (job may have expired)',
      };
    }
    return { status: 500, error: msg };
  }
}

/**
 * Export the full execution tree of a workflow.
 *
 * Resolves the workflow handle, then exports its execution graph including
 * activity inputs and results. Returns 404 if the workflow cannot be found
 * or its data has expired.
 *
 * @param input.workflowId — the workflow's unique identifier
 * @param input.excludeSystem — when true, omit system-generated activities from the export
 * @param input.omitResults — when true, exclude activity result payloads
 * @param input.mode — export mode controlling output format (e.g., tree, flat)
 * @param input.maxDepth — maximum depth to traverse in the execution tree
 * @returns `{ status: 200, data: ExecutionExport }` on success
 */
export async function exportWorkflowExecution(input: {
  workflowId: string;
  excludeSystem?: boolean;
  omitResults?: boolean;
  mode?: ExportMode;
  maxDepth?: number;
}): Promise<LTApiResult> {
  try {
    let resolved;
    try {
      resolved = await resolveWorkflowHandle(input.workflowId);
    } catch {
      return { status: 404, error: 'Workflow not found' };
    }

    const execution = await exportService.exportWorkflowExecution(
      input.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
      {
        exclude_system: input.excludeSystem ?? false,
        omit_results: input.omitResults ?? false,
        mode: input.mode || undefined,
        max_depth: input.maxDepth,
        enrich_inputs: true,
      },
    );

    return { status: 200, data: execution };
  } catch (err: any) {
    const status = err.status === 404 || err.message?.includes('Not Found') ? 404 : 500;
    return {
      status,
      error: status === 404
        ? 'Workflow data is no longer available (job may have expired)'
        : err.message,
    };
  }
}

/**
 * Get the current status of a workflow (e.g., running, completed, failed).
 *
 * Resolves the workflow handle, then queries its status. Returns 404 if the
 * workflow cannot be found or its data has expired.
 *
 * @param input.workflowId — the workflow's unique identifier
 * @returns `{ status: 200, data: WorkflowStatus }` on success
 */
export async function getWorkflowStatus(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    let resolved;
    try {
      resolved = await resolveWorkflowHandle(input.workflowId);
    } catch {
      return { status: 404, error: 'Workflow not found' };
    }

    const result = await exportService.getWorkflowStatus(
      input.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
    );

    return { status: 200, data: result };
  } catch (err: any) {
    const status = err.status === 404 || err.message?.includes('Not Found') ? 404 : 500;
    return {
      status,
      error: status === 404
        ? 'Workflow data is no longer available (job may have expired)'
        : err.message,
    };
  }
}

/**
 * Get the current state data of a workflow.
 *
 * Resolves the workflow handle, then retrieves its full state. Returns 404
 * if the workflow cannot be found or its data has expired.
 *
 * @param input.workflowId — the workflow's unique identifier
 * @returns `{ status: 200, data: WorkflowState }` on success
 */
export async function getWorkflowState(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    let resolved;
    try {
      resolved = await resolveWorkflowHandle(input.workflowId);
    } catch {
      return { status: 404, error: 'Workflow not found' };
    }

    const result = await exportService.getWorkflowState(
      input.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
    );

    return { status: 200, data: result };
  } catch (err: any) {
    const status = err.status === 404 || err.message?.includes('Not Found') ? 404 : 500;
    return {
      status,
      error: status === 404
        ? 'Workflow data is no longer available (job may have expired)'
        : err.message,
    };
  }
}
