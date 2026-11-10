/**
 * The workflows the gateway starts for rows it parks, as an interface so the
 * gateway runs the same against Long Tail in process or a fake. A start names
 * its workflow id, so a second start of the same row finds the first.
 */

export const START_OUTCOME = {
  STARTED: 'started',
  /** A workflow with this id already exists: the row's workflow was started before. */
  ALREADY: 'already',
} as const;
export type StartOutcome = typeof START_OUTCOME[keyof typeof START_OUTCOME];

/** A start refused for its configuration (an unknown type, one not invocable, no starter): starting again would fail the same way. */
export class WorkflowStartRefused extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'WorkflowStartRefused';
  }
}

export interface LineWorkflows {
  /** Start `type` once under `workflowId`, with `data` as its input. */
  start(type: string, workflowId: string, data: Record<string, unknown>): Promise<StartOutcome>;
}

/** The starter of a gateway given none: any start is refused, naming the workflow, so a codec that asks for one is told. */
export const NO_WORKFLOWS: LineWorkflows = {
  async start(type) {
    throw new WorkflowStartRefused(`this gateway has no workflow starter, so ${type} cannot start`);
  },
};
