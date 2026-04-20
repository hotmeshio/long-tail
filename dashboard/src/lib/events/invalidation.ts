import type { NatsLTEvent } from '../nats/types';

/**
 * Map an event to the React Query keys that should be invalidated.
 *
 * Returns an array of query key prefixes. React Query's `invalidateQueries`
 * will match all queries whose key starts with any returned prefix.
 *
 * This is pure logic with no React or transport dependency — easily testable.
 * Works identically regardless of event transport (Socket.IO, NATS, etc.).
 */
export function getInvalidationKeys(event: NatsLTEvent): string[][] {
  const keys: string[][] = [];
  const category = event.type.split('.')[0];

  switch (category) {
    case 'task':
      keys.push(['tasks']);
      keys.push(['jobs']);
      keys.push(['processes']);
      if (event.workflowId) {
        keys.push(['workflowExecution', event.workflowId]);
        keys.push(['workflowState', event.workflowId]);
        keys.push(['mcpQueryExecution', event.workflowId]);
      }
      if (event.originId) {
        keys.push(['processes', event.originId]);
      }
      break;

    case 'escalation':
      keys.push(['escalations']);
      keys.push(['escalationStats']);
      if (event.workflowId) {
        keys.push(['workflowExecution', event.workflowId]);
      }
      break;

    case 'workflow':
      keys.push(['jobs']);
      keys.push(['tasks']);
      keys.push(['processes']);
      if (event.workflowId) {
        keys.push(['workflowExecution', event.workflowId]);
        keys.push(['workflowState', event.workflowId]);
        keys.push(['mcpQueryExecution', event.workflowId]);
        keys.push(['mcpQueryResult', event.workflowId]);
        keys.push(['builderResult', event.workflowId]);
      }
      break;

    case 'activity':
      if (event.workflowId) {
        keys.push(['mcpRunExecution', event.workflowId]);
      }
      keys.push(['mcpRuns']);
      break;

    case 'milestone':
      if (event.workflowId) {
        keys.push(['workflowExecution', event.workflowId]);
        keys.push(['mcpQueryExecution', event.workflowId]);
      }
      keys.push(['tasks']);
      break;

    default:
      keys.push(['jobs']);
      keys.push(['tasks']);
      break;
  }

  return keys;
}
