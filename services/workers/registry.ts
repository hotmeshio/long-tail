/**
 * In-memory registry of active durable workers.
 * Populated at startup after `Durable.Worker.create()`.
 */

const workers = new Map<string, { taskQueue: string }>();

export function registerWorker(name: string, taskQueue: string) {
  workers.set(name, { taskQueue });
}

export function getRegisteredWorkers(): Map<string, { taskQueue: string }> {
  return workers;
}

/** System workflows excluded from the overview by default. */
export const SYSTEM_WORKFLOWS = new Set([
  'mcpQuery',
  'mcpDeterministic',
  'mcpQueryRouter',
  'mcpTriage',
  'mcpTriageRouter',
  'mcpTriageDeterministic',
  'insightQuery',
]);
