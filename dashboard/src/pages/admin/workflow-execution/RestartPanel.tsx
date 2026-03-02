import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInvokeWorkflow } from '../../../api/workflows';
import { Collapsible } from '../../../components/common/Collapsible';
import type { WorkflowExecution } from '../../../api/types';

interface RestartPanelProps {
  execution: WorkflowExecution;
  state?: Record<string, unknown>;
  envelope?: string | null;
  /** LT workflow type from task record (e.g., "reviewContent"), preferred over execution.workflow_type which may be HotMesh-prefixed. */
  workflowType?: string | null;
  /** Controlled open state from parent (e.g., via Actions menu) */
  forceOpen?: boolean;
  /** Called when the panel is closed */
  onClose?: () => void;
}

function parseEnvelope(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export function RestartPanel({ execution, envelope, workflowType, forceOpen, onClose }: RestartPanelProps) {
  const navigate = useNavigate();
  const invokeMutation = useInvokeWorkflow();
  const [open, setOpen] = useState(false);
  const [parseError, setParseError] = useState('');

  // Sync with parent's forceOpen prop
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  // Use the task envelope (original LT input) — not the HotMesh job output
  const originalInput = parseEnvelope(envelope) ?? {};

  const [jsonInput, setJsonInput] = useState(() =>
    JSON.stringify(originalInput, null, 2),
  );

  // Update when envelope arrives asynchronously from task query
  useEffect(() => {
    const parsed = parseEnvelope(envelope);
    if (parsed) setJsonInput(JSON.stringify(parsed, null, 2));
  }, [envelope]);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  const handleRestart = async () => {
    setParseError('');
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(jsonInput);
    } catch {
      setParseError('Invalid JSON');
      return;
    }

    // Always start fresh — strip prior routing and resolver state
    delete envelope.lt;
    delete envelope.resolver;

    // Prefer the LT task workflow type; fall back to execution (HotMesh) type
    const resolvedType = workflowType || execution.workflow_type;

    try {
      const result = await invokeMutation.mutateAsync({
        workflowType: resolvedType,
        data: (envelope.data ?? envelope) as Record<string, unknown>,
        metadata: (envelope.metadata ?? {}) as Record<string, unknown>,
      });
      navigate(`/workflows/execution/${result.workflowId}`);
    } catch {
      // error available via invokeMutation.error
    }
  };

  return (
    <div className="mb-6">
      <Collapsible open={open}>
        <div className="py-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
              Restart Workflow
            </p>
            <button onClick={handleClose} className="btn-ghost text-xs">
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
                Workflow Type
              </p>
              <p className="text-xs font-mono text-text-primary">
                {workflowType || execution.workflow_type}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
                Task Queue
              </p>
              <p className="text-xs font-mono text-text-primary">
                {execution.task_queue}
              </p>
            </div>
          </div>

          <label className="block text-xs text-text-secondary mb-2">
            Envelope Data (JSON)
          </label>
          <textarea
            value={jsonInput}
            onChange={(e) => {
              setJsonInput(e.target.value);
              setParseError('');
            }}
            className="input font-mono text-xs"
            rows={8}
            spellCheck={false}
          />

          {parseError && (
            <p className="text-xs text-status-error mt-2">{parseError}</p>
          )}
          {invokeMutation.error && (
            <p className="text-xs text-status-error mt-2">
              {invokeMutation.error.message}
            </p>
          )}

          <button
            onClick={handleRestart}
            disabled={invokeMutation.isPending}
            className="btn-primary mt-4"
          >
            {invokeMutation.isPending ? 'Starting...' : 'Restart'}
          </button>
        </div>
      </Collapsible>
    </div>
  );
}
