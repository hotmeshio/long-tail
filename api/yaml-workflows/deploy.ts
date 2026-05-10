import * as yamlDb from '../../services/yaml-workflow/db';
import * as yamlDeployer from '../../services/yaml-workflow/deployer';
import * as yamlWorkers from '../../services/yaml-workflow/workers';
import { invokeYamlWorkflow as invokeYamlWorkflowService } from '../../services/yaml-workflow/invoke';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';
import { isNotFoundError } from './helpers';

/**
 * Deploy a YAML workflow and all sibling workflows sharing its app_id namespace.
 *
 * Merges and deploys the full app_id YAML, registers HotMesh workers for every
 * non-archived sibling, transitions draft/deployed siblings to active, and marks
 * the app_id content as deployed. Uses the app_version declared in the workflow record.
 *
 * @param input.id — UUID of the workflow to deploy
 * @returns `{ status: 200, data: YamlWorkflow }` the refreshed workflow record after deployment
 */
export async function deployYamlWorkflow(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }

    // Compute the next app-level version for the namespace.
    // Each deploy increments regardless of individual tool versions —
    // adding a second tool (v1 of itself) to an app already at v1 produces app v2.
    const deployVersion = await yamlDb.getNextAppVersion(wf.app_id);

    // Deploy + activate merged YAML for the full app_id
    const siblings = await yamlDb.listYamlWorkflowsByAppId(wf.app_id);
    await yamlDeployer.deployAppId(wf.app_id, deployVersion);

    // Register workers and mark all non-archived siblings as active
    for (const sibling of siblings) {
      await yamlDb.updateYamlWorkflowVersion(sibling.id, deployVersion);
      await yamlWorkers.registerWorkersForWorkflow(sibling);
      if (sibling.status === 'draft' || sibling.status === 'deployed') {
        await yamlDb.updateYamlWorkflowStatus(sibling.id, 'active');
      }
    }

    // Mark content as deployed for the entire app_id
    await yamlDb.markAppIdContentDeployed(wf.app_id);

    const updated = await yamlDb.getYamlWorkflow(input.id);
    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return {
      status: 500,
      error: err.message,
    };
  }
}

/**
 * Activate a previously deployed YAML workflow and its app_id siblings.
 *
 * Calls the deployer to activate the app_id at its current version, then registers
 * HotMesh workers for all sibling workflows. Siblings in "deployed" status are
 * transitioned to "active". The workflow must already be in deployed or active status.
 *
 * @param input.id — UUID of the workflow to activate
 * @returns `{ status: 200, data: YamlWorkflow }` the refreshed workflow record after activation
 */
export async function activateYamlWorkflow(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    if (wf.status !== 'deployed' && wf.status !== 'active') {
      return { status: 400, error: 'Workflow must be deployed before activation' };
    }

    await yamlDeployer.activateYamlWorkflow(wf.app_id, wf.app_version);

    // Register workers for ALL workflows sharing this app_id
    const siblings = await yamlDb.listYamlWorkflowsByAppId(wf.app_id);
    for (const sibling of siblings) {
      await yamlWorkers.registerWorkersForWorkflow(sibling);
      if (sibling.status === 'deployed') {
        await yamlDb.updateYamlWorkflowStatus(sibling.id, 'active');
      }
    }

    const updated = await yamlDb.getYamlWorkflow(input.id);
    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Invoke an active YAML workflow, executing its DAG pipeline.
 *
 * The workflow must be in "active" status. Delegates to the invoke service which
 * starts the HotMesh execution. Supports both synchronous (wait for result) and
 * asynchronous (fire-and-forget) invocation modes.
 *
 * @param input.id — UUID of the workflow to invoke
 * @param input.data — input payload passed to the workflow's entry point
 * @param input.sync — when true, block until the workflow completes and return its output
 * @param input.timeout — max milliseconds to wait when sync is true
 * @param input.execute_as — override identity for the execution context
 * @param auth — authenticated user context; userId is forwarded to the invoke service
 * @returns `{ status: 200, data: ... }` workflow execution result (sync) or job metadata (async)
 */
export async function invokeYamlWorkflow(input: {
  id: string;
  data?: any;
  sync?: boolean;
  timeout?: number;
  execute_as?: string;
}, auth?: LTApiAuth): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    if (wf.status !== 'active') {
      return { status: 400, error: 'Workflow must be active to invoke' };
    }

    const result = await invokeYamlWorkflowService(wf, {
      data: input.data,
      sync: input.sync,
      timeout: input.timeout,
      execute_as: input.execute_as,
      userId: auth?.userId,
    });
    return { status: 200, data: result };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Archive a YAML workflow, removing it from active service.
 *
 * If the workflow is currently active, its HotMesh engine is stopped before
 * transitioning the status to "archived". Archived workflows cannot be invoked
 * or regenerated but can still be viewed or deleted.
 *
 * @param input.id — UUID of the workflow to archive
 * @returns `{ status: 200, data: YamlWorkflow }` the updated record with status "archived"
 */
export async function archiveYamlWorkflow(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    if (wf.status === 'active') {
      await yamlDeployer.stopEngine(wf.app_id);
    }
    const updated = await yamlDb.updateYamlWorkflowStatus(wf.id, 'archived');
    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Restore an archived YAML workflow back to draft status.
 *
 * Transitions the workflow from "archived" to "draft" so it can be
 * redeployed. The workflow must be in "archived" status.
 */
export async function restoreYamlWorkflow(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    if (wf.status !== 'archived') {
      return { status: 400, error: 'Only archived workflows can be restored' };
    }
    const updated = await yamlDb.updateYamlWorkflowStatus(wf.id, 'draft');
    return { status: 200, data: updated };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}
