/**
 * Router activities — discovery, matching, and input extraction.
 * These run in the router workflow, NOT in the dynamic mcpQuery workflow,
 * so they don't pollute the execution trace that gets compiled to YAML.
 */
export {
  findCompiledWorkflows,
  evaluateWorkflowMatch,
  extractWorkflowInputs,
} from '../mcp-query/activities';
