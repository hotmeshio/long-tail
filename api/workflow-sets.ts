import {
  createWorkflowSet as createWorkflowSetService,
  getWorkflowSet as getWorkflowSetService,
  updateWorkflowSetPlan,
  updateWorkflowSetStatus,
  updateWorkflowSetSourceWorkflow,
  listWorkflowSets as listWorkflowSetsService,
} from '../services/workflow-sets';
import { startWorkflowPlanner } from '../services/insight';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

/**
 * Create a new workflow set and kick off the LLM-powered planner.
 *
 * Persists the workflow set record, then starts an async planner workflow
 * that generates the plan from the specification. Requires at least one
 * LLM API key (OPENAI_API_KEY or ANTHROPIC_API_KEY) to be configured.
 * Returns 409 if a workflow set with the same name already exists.
 *
 * @param input.name — unique name for the workflow set (required)
 * @param input.description — optional description of the workflow set
 * @param input.specification — free-text specification the planner uses to generate workflows (required)
 * @param auth — authenticated user context; userId is forwarded to the planner
 * @returns `{ status: 201, data: { ...set, source_workflow_id, planner_workflow_id } }` the created set with planner IDs
 */
export async function createWorkflowSet(
  input: { name: string; description?: string; specification: string },
  auth?: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.specification || typeof input.specification !== 'string') {
      return { status: 400, error: 'specification is required' };
    }
    if (!input.name || typeof input.name !== 'string') {
      return { status: 400, error: 'name is required' };
    }
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      return { status: 503, error: 'Workflow planner requires an LLM API key' };
    }

    const set = await createWorkflowSetService({
      name: input.name,
      description: input.description,
      specification: input.specification,
    });

    const plannerResult = await startWorkflowPlanner({
      specification: input.specification,
      setId: set.id,
      wait: false,
      userId: auth?.userId,
    });

    await updateWorkflowSetSourceWorkflow(set.id, plannerResult.workflow_id);

    return {
      status: 201,
      data: {
        ...set,
        source_workflow_id: plannerResult.workflow_id,
        planner_workflow_id: plannerResult.workflow_id,
      },
    };
  } catch (err: any) {
    if (err.code === '23505') {
      return { status: 409, error: 'A workflow set with this name already exists' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * List workflow sets with optional filtering and pagination.
 *
 * @param input.status — filter by workflow set status
 * @param input.search — free-text search term to match against set names or descriptions
 * @param input.limit — maximum number of results to return
 * @param input.offset — number of results to skip for pagination
 * @returns `{ status: 200, data: WorkflowSet[] }` paginated list of workflow sets
 */
export async function listWorkflowSets(
  input: { status?: string; search?: string; limit?: number; offset?: number },
): Promise<LTApiResult> {
  try {
    const result = await listWorkflowSetsService({
      status: input.status as any,
      search: input.search,
      limit: input.limit,
      offset: input.offset,
    });
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Retrieve a single workflow set by ID.
 *
 * @param input.id — unique identifier of the workflow set
 * @returns `{ status: 200, data: WorkflowSet }` the workflow set record, or 404 if not found
 */
export async function getWorkflowSet(
  input: { id: string },
): Promise<LTApiResult> {
  try {
    const set = await getWorkflowSetService(input.id);
    if (!set) {
      return { status: 404, error: 'Workflow set not found' };
    }
    return { status: 200, data: set };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Replace the plan and optional namespaces on a workflow set.
 *
 * @param input.id — unique identifier of the workflow set to update
 * @param input.plan — array of plan entries (required, must be an array)
 * @param input.namespaces — optional array of namespace definitions associated with the plan
 * @returns `{ status: 200, data: WorkflowSet }` the updated workflow set, or 404 if not found
 */
export async function updateWorkflowSetPlanApi(
  input: { id: string; plan: any[]; namespaces?: any[] },
): Promise<LTApiResult> {
  try {
    if (!Array.isArray(input.plan)) {
      return { status: 400, error: 'plan must be an array' };
    }
    const updated = await updateWorkflowSetPlan(input.id, input.plan, input.namespaces || []);
    if (!updated) {
      return { status: 404, error: 'Workflow set not found' };
    }
    return { status: 200, data: updated };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Transition a workflow set from "planned" to "building" status.
 *
 * Returns 409 if the set is not currently in "planned" status.
 *
 * @param input.id — unique identifier of the workflow set to build
 * @returns `{ status: 200, data: { status: 'building', id } }` confirmation the build has started
 */
export async function buildWorkflowSet(
  input: { id: string },
): Promise<LTApiResult> {
  try {
    const set = await getWorkflowSetService(input.id);
    if (!set) {
      return { status: 404, error: 'Workflow set not found' };
    }
    if (set.status !== 'planned') {
      return { status: 409, error: `Cannot build set in '${set.status}' status` };
    }
    await updateWorkflowSetStatus(input.id, 'building');
    return { status: 200, data: { status: 'building', id: input.id } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Transition a workflow set to "deploying" status.
 *
 * @param input.id — unique identifier of the workflow set to deploy
 * @returns `{ status: 200, data: { status: 'deploying', id } }` confirmation the deploy has started
 */
export async function deployWorkflowSet(
  input: { id: string },
): Promise<LTApiResult> {
  try {
    const set = await getWorkflowSetService(input.id);
    if (!set) {
      return { status: 404, error: 'Workflow set not found' };
    }
    await updateWorkflowSetStatus(input.id, 'deploying');
    return { status: 200, data: { status: 'deploying', id: input.id } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
