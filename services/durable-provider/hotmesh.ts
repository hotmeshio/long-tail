import {
  DURABLE_PROVIDER,
  JOB_STATE,
  type LTDurableProvider,
  type LTExecutionExportOptions,
  type LTJobStatus,
  type LTWorkflowExecution,
} from '../../types/durable-provider';
import { resolveWorkflowHandle } from '../task/resolve';
import { getHandle } from '../export/client';
import { exportWorkflowExecution } from '../export';
import { readWorkflowState, WORKFLOW_STATES } from '../workflow-state';
import { cancelEscalationsByWorkflowId } from '../escalation';

/**
 * HotMesh as a provider. HotMesh rows wake through `signal_key` inside the
 * resolve transaction, so `deliver` is never called for them.
 */
export function createHotMeshProvider(): LTDurableProvider {
  return {
    name: DURABLE_PROVIDER.HOTMESH,
    capabilities: { native: true, execution: true, terminate: true, list: true },

    async deliver() {
      throw new Error('HotMesh escalations resume through signal_key; the relay never delivers to HotMesh');
    },

    async describe(workflowId: string): Promise<LTJobStatus> {
      const resolved = await resolveWorkflowHandle(workflowId);
      const handle = await getHandle(resolved.taskQueue, resolved.workflowName, workflowId);
      const reading = await readWorkflowState(handle);
      return {
        workflowId,
        workflowType: resolved.workflowName,
        state: reading.terminated
          ? JOB_STATE.TERMINATED
          : reading.state === WORKFLOW_STATES.RUNNING
            ? JOB_STATE.RUNNING
            : reading.state === WORKFLOW_STATES.COMPLETED ? JOB_STATE.COMPLETED : JOB_STATE.FAILED,
        providerState: String(reading.status),
      };
    },

    async export(workflowId: string, options: LTExecutionExportOptions = {}): Promise<LTWorkflowExecution> {
      const resolved = await resolveWorkflowHandle(workflowId);
      const execution = await exportWorkflowExecution(workflowId, resolved.taskQueue, resolved.workflowName, {
        exclude_system: options.excludeSystem ?? false,
        omit_results: options.omitResults ?? false,
        mode: options.mode,
        max_depth: options.maxDepth,
      });
      return execution as unknown as LTWorkflowExecution;
    },

    async terminate(workflowId: string): Promise<void> {
      const resolved = await resolveWorkflowHandle(workflowId);
      const handle = await getHandle(resolved.taskQueue, resolved.workflowName, workflowId);
      await handle.terminate();
      await cancelEscalationsByWorkflowId(workflowId);
    },
  };
}
