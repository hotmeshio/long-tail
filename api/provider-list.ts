import { durableProviderRegistry } from '../services/durable-provider';
import {
  JOB_STATE,
  WORKFLOW_LIST_STATE,
  type LTJobStatus,
  type LTWorkflowListState,
} from '../types/durable-provider';
import type { LTApiResult } from '../types/sdk';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const UNSAFE_FILTER = /['"\\,]/;
const LIST_STATES = Object.values(WORKFLOW_LIST_STATE) as string[];

export interface ProviderListInput {
  limit?: number;
  offset?: number;
  entity?: string;
  search?: string;
  status?: string;
}

/**
 * The executions list from the configured engine, in the shape the HotMesh
 * list returns. `entity` is one workflow type, `search` a workflow id prefix.
 */
export async function listFromProvider(input: ProviderListInput): Promise<LTApiResult> {
  // 1. The engine must list
  const provider = durableProviderRegistry.current;
  if (!provider.list) return { status: 501, error: `The ${provider.name} provider does not list workflows` };

  // 2. Validate filters
  if (input.status && !LIST_STATES.includes(input.status)) {
    return { status: 400, error: `status must be one of ${LIST_STATES.join(', ')}` };
  }
  if ([input.entity, input.search].some((value) => value && UNSAFE_FILTER.test(value))) {
    return { status: 400, error: 'Type and search take one value without quotes, commas or backslashes' };
  }

  // 3. Ask the engine
  try {
    const page = await provider.list({
      limit: Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
      offset: Math.max(input.offset ?? 0, 0),
      ...(input.entity ? { workflowType: input.entity } : {}),
      ...(input.search ? { idPrefix: input.search } : {}),
      ...(input.status ? { state: input.status as LTWorkflowListState } : {}),
    });
    return { status: 200, data: { jobs: page.workflows.map(toJobRow), total: page.total } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

function toJobRow(workflow: LTJobStatus) {
  return {
    workflow_id: workflow.workflowId,
    entity: workflow.workflowType ?? '',
    status: toListState(workflow.state),
    provider_status: workflow.providerState,
    is_live: workflow.state === JOB_STATE.RUNNING,
    created_at: workflow.startedAt ?? null,
    updated_at: workflow.closedAt ?? workflow.startedAt ?? null,
  };
}

function toListState(state: LTJobStatus['state']): LTWorkflowListState {
  if (state === JOB_STATE.RUNNING) return WORKFLOW_LIST_STATE.RUNNING;
  if (state === JOB_STATE.COMPLETED) return WORKFLOW_LIST_STATE.COMPLETED;
  return WORKFLOW_LIST_STATE.FAILED;
}
