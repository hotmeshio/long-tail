/**
 * Router activities — discovery, matching, and input extraction.
 * These run in the router workflow, NOT in the dynamic mcpTriage workflow,
 * so they don't pollute the execution trace that gets compiled to YAML.
 *
 * Function names are unique to avoid collisions with mcpQuery activities
 * on the same task queue.
 */
export {
  findTriageWorkflows,
  evaluateTriageMatch,
  extractTriageInputs,
} from '../../activities/triage';
