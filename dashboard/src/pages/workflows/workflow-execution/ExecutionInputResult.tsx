import { JsonViewer } from '../../../components/common/data/JsonViewer';
import type { WorkflowExecution } from '../../../api/types';

interface ExecutionInputResultProps {
  execution: WorkflowExecution;
}

/**
 * Extract the workflow input envelope from the workflow_execution_started event.
 * HotMesh 0.13.0+ includes the actual trigger arguments (the envelope passed
 * to startWorkflow) in the start event's `input` attribute.
 */
function extractInput(execution: WorkflowExecution): Record<string, unknown> | null {
  const startEvent = execution.events.find(
    (e) => e.event_type === 'workflow_execution_started',
  );
  const input = (startEvent?.attributes as any)?.input;
  return input && typeof input === 'object' ? input : null;
}

export function ExecutionInputResult({ execution }: ExecutionInputResultProps) {
  const input = extractInput(execution);

  // Result: unwrap the workflow return — the `data` field is what LT users care about
  const rawResult = execution.result as Record<string, unknown> | null | undefined;
  const result = rawResult?.data ?? rawResult ?? null;

  if (!input && !result) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {input !== null && (
        <div>
          <JsonViewer data={input} label="Input Envelope" />
        </div>
      )}
      {result !== null && (
        <div>
          <JsonViewer data={result} label="Result" />
        </div>
      )}
    </div>
  );
}
