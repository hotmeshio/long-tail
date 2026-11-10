/**
 * LineWorkflows backed by the workflow invocation service in process, run as
 * the line's controller. The codec that names the workflow is code-owned
 * configuration, so the start takes the service path cron uses, not the
 * per-caller invoke gate.
 */

import { InvocationError, invokeWorkflow } from '../../workflow-invocation';
import { START_OUTCOME, WorkflowStartRefused, type LineWorkflows, type StartOutcome } from './workflows';

const CLIENT_ERROR = 500;

export class ApiLineWorkflows implements LineWorkflows {
  constructor(private readonly controllerId: () => string) {}

  async start(type: string, workflowId: string, data: Record<string, unknown>): Promise<StartOutcome> {
    try {
      await invokeWorkflow({ workflowType: type, data, options: { workflowId }, auth: { userId: this.controllerId() } });
      return START_OUTCOME.STARTED;
    } catch (err) {
      if (String((err as Error)?.message).includes('Duplicate job')) return START_OUTCOME.ALREADY;
      if (err instanceof InvocationError && err.statusCode < CLIENT_ERROR) throw new WorkflowStartRefused(`${type}: ${err.message}`, err);
      throw err;
    }
  }
}
