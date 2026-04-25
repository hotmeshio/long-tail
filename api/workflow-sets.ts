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
