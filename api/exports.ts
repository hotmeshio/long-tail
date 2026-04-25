import * as exportService from '../services/export';
import { resolveWorkflowHandle } from '../services/task/resolve';
import type { LTApiResult } from '../types/sdk';
import type { LTExportField } from '../types';
import type { ExportMode } from '@hotmeshio/hotmesh/build/types/exporter';

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
