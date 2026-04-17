import {
  findCompiledWorkflows as findCompiledWorkflowsShared,
  evaluateWorkflowMatch as evaluateWorkflowMatchShared,
  extractWorkflowInputs,
} from '../../workflows/shared/discovery';
import type { WorkflowCandidate } from '../../../types/discovery';
import { yamlWorkflowMap, toolDefCache } from './cache';

export async function findTriageWorkflows(
  prompt: string,
): Promise<{
  inventory: string;
  toolIds: string[];
  candidates: WorkflowCandidate[];
}> {
  return findCompiledWorkflowsShared(prompt, { yamlWorkflowMap, toolDefCache }, 'mcpTriage');
}

export async function evaluateTriageMatch(
  prompt: string,
  candidates: WorkflowCandidate[],
): Promise<{ matched: boolean; workflowName: string | null; confidence: number }> {
  return evaluateWorkflowMatchShared(prompt, candidates, 'mcpTriage');
}

export { extractWorkflowInputs as extractTriageInputs };
