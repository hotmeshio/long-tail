import { createClient } from '../../workers';
import * as exportService from '../../services/export';
import { resolveWorkflowHandle } from '../../services/task';
import {
  invokeWorkflow as invokeWorkflowService,
  checkInvocationRoles,
  InvocationError,
} from '../../services/workflow-invocation';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

function isResolveError(err: any): boolean {
  return err?.message?.includes('Cannot resolve workflow');
}

/**
 * Start a workflow — proxy for `Durable.Client.workflow.start()`.
 *
 * Resolves the task queue, enforces auth/role constraints, builds the
 * LTEnvelope with IAM context, and delegates to the Durable client.
 * Any WorkflowOptions field (workflowId, expire, entity, namespace,
 * search, signalIn, pending, etc.) can be passed via `options` and
 * flows through to the Durable client unchanged.
 *
 * @see https://docs.hotmesh.io/types/types_durable.WorkflowOptions.html
 */
export async function invokeWorkflow(
  input: {
    type: string;
    data?: Record<string, any>;
    metadata?: Record<string, any>;
    execute_as?: string;
    /** Passthrough to Durable WorkflowOptions. */
    options?: Record<string, any>;
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    await checkInvocationRoles(input.type, auth.userId, auth.role);

    const result = await invokeWorkflowService({
      workflowType: input.type,
      data: input.data || {},
      metadata: input.metadata,
      executeAs: input.execute_as,
      options: input.options,
      auth: {
        userId: auth.userId,
        role: auth.role,
        scopes: auth.scopes,
      },
    });

    return {
      status: 202,
      data: { workflowId: result.workflowId, message: 'Workflow started' },
    };
  } catch (err: any) {
    const status = err instanceof InvocationError ? err.statusCode : 500;
    return { status, error: err.message };
  }
}

/**
 * Get the execution status of a workflow.
 *
 * Returns the HotMesh status code (0 = completed, 1 = running).
 * Resolves the workflow handle via task record or worker registry.
 *
 * @param input.workflowId — HotMesh workflow ID
 * @returns `{ status: 200, data: { workflowId, status } }` or 404
 */
export async function getWorkflowStatus(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    const resolved = await resolveWorkflowHandle(input.workflowId);

    const client = createClient();
    const handle = await client.workflow.getHandle(
      resolved.taskQueue,
      resolved.workflowName,
      input.workflowId,
    );
    const status = await handle.status();

    return {
      status: 200,
      data: { workflowId: input.workflowId, status },
    };
  } catch (err: any) {
    if (isResolveError(err)) return { status: 404, error: err.message };
    return { status: 500, error: err.message };
  }
}

/**
 * Get the result of a completed workflow.
 *
 * Returns 202 if the workflow is still running, 200 with the result
 * payload when complete. Never blocks — always returns immediately.
 *
 * @param input.workflowId — HotMesh workflow ID
 * @returns `{ status: 200, data: { workflowId, result } }` or 202 if running
 */
export async function getWorkflowResult(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    const resolved = await resolveWorkflowHandle(input.workflowId);

    const client = createClient();
    const handle = await client.workflow.getHandle(
      resolved.taskQueue,
      resolved.workflowName,
      input.workflowId,
    );
    const status = await handle.status();

    if (status !== 0) {
      return {
        status: 202,
        data: { workflowId: input.workflowId, status: 'running' },
      };
    }

    const result = await handle.result();
    return {
      status: 200,
      data: { workflowId: input.workflowId, result },
    };
  } catch (err: any) {
    if (isResolveError(err)) return { status: 404, error: err.message };
    return { status: 500, error: err.message };
  }
}

/**
 * Terminate a running workflow.
 *
 * Interrupts the workflow execution immediately via HotMesh.
 *
 * @param input.workflowId — HotMesh workflow ID
 * @returns `{ status: 200, data: { terminated: true, workflowId } }` or 404
 */
export async function terminateWorkflow(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    const resolved = await resolveWorkflowHandle(input.workflowId);

    const client = createClient();
    const handle = await client.workflow.getHandle(
      resolved.taskQueue,
      resolved.workflowName,
      input.workflowId,
    );

    await handle.terminate();

    return {
      status: 200,
      data: { terminated: true, workflowId: input.workflowId },
    };
  } catch (err: any) {
    if (isResolveError(err)) return { status: 404, error: err.message };
    return { status: 500, error: err.message };
  }
}

/**
 * Export the full state of a workflow.
 *
 * Returns the serialized workflow state including all activity
 * results, signals, and metadata.
 *
 * @param input.workflowId — HotMesh workflow ID
 * @returns `{ status: 200, data: <exported state> }` or 404
 */
export async function exportWorkflow(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    const resolved = await resolveWorkflowHandle(input.workflowId);

    const exported = await exportService.exportWorkflow(
      input.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
    );

    return { status: 200, data: exported };
  } catch (err: any) {
    if (isResolveError(err)) return { status: 404, error: err.message };
    return { status: 500, error: err.message };
  }
}
