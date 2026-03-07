import type { NatsLTEvent } from './types';

/**
 * Map a NATS event to the React Query keys that should be invalidated.
 *
 * Returns an array of query key prefixes. React Query's `invalidateQueries`
 * will match all queries whose key starts with any returned prefix.
 *
 * This is pure logic with no React dependency — easily testable.
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
      }
      break;

    case 'milestone':
      if (event.workflowId) {
        keys.push(['workflowExecution', event.workflowId]);
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
