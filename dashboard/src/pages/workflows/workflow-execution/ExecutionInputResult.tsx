import { JsonViewer } from '../../../components/common/data/JsonViewer';
import type { WorkflowExecution } from '../../../api/types';

interface ExecutionInputResultProps {
  execution: WorkflowExecution;
  envelope?: string | null;
}

function parseEnvelope(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export function ExecutionInputResult({ execution, envelope }: ExecutionInputResultProps) {
  const input = parseEnvelope(envelope);

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
