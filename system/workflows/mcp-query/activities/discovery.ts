import {
  findCompiledWorkflows as findCompiledWorkflowsShared,
  evaluateWorkflowMatch as evaluateWorkflowMatchShared,
  extractWorkflowInputs,
} from '../../shared/discovery';
import type { WorkflowCandidate } from '../../../../types/discovery';
import { yamlWorkflowMap, toolDefCache } from './caches';

export async function findCompiledWorkflows(
  prompt: string,
): Promise<{
  inventory: string;
  toolIds: string[];
  candidates: WorkflowCandidate[];
}> {
  return findCompiledWorkflowsShared(prompt, { yamlWorkflowMap, toolDefCache }, 'mcpQuery');
}

export async function evaluateWorkflowMatch(
  prompt: string,
  candidates: WorkflowCandidate[],
): Promise<{ matched: boolean; workflowName: string | null; confidence: number }> {
  return evaluateWorkflowMatchShared(prompt, candidates, 'mcpQuery');
}

export { extractWorkflowInputs };
