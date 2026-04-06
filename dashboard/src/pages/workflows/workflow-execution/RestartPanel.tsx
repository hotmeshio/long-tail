import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInvokeWorkflow } from '../../../api/workflows';
import { Collapsible } from '../../../components/common/layout/Collapsible';
import { WorkflowPill } from '../../../components/common/display/WorkflowPill';
import type { WorkflowExecution } from '../../../api/types';

interface RestartPanelProps {
  execution: WorkflowExecution;
  state?: Record<string, unknown>;
  /** Controlled open state from parent (e.g., via Actions menu) */
  forceOpen?: boolean;
  /** Called when the panel is closed */
  onClose?: () => void;
}

/**
 * Extract the workflow input envelope from the workflow_execution_started event.
 */
function extractInput(execution: WorkflowExecution): Record<string, unknown> | null {
  const startEvent = execution.events.find(
    (e) => e.event_type === 'workflow_execution_started',
  );
  const input = (startEvent?.attributes as any)?.input;
  return input && typeof input === 'object' ? input : null;
}

export function RestartPanel({ execution, forceOpen, onClose }: RestartPanelProps) {
  const navigate = useNavigate();
  const invokeMutation = useInvokeWorkflow();
  const [open, setOpen] = useState(false);
  const [parseError, setParseError] = useState('');

  // Sync with parent's forceOpen prop
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const originalInput = extractInput(execution) ?? {};
  // Derive entity from workflow_id (format: {entity}-{guid})
  // The workflow_type field contains the HotMesh topic, not the invocable entity name
  const workflowType = execution.workflow_id.replace(/-[A-Za-z0-9_-]{20,}$/, '');

  const [jsonInput, setJsonInput] = useState(() =>
    JSON.stringify(originalInput, null, 2),
  );

  // Update when execution data changes
  useEffect(() => {
    const input = extractInput(execution);
    if (input) setJsonInput(JSON.stringify(input, null, 2));
  }, [execution]);

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

    try {
      const result = await invokeMutation.mutateAsync({
        workflowType,
        data: (envelope.data ?? envelope) as Record<string, unknown>,
        metadata: (envelope.metadata ?? {}) as Record<string, unknown>,
      });
      navigate(`/workflows/executions/${result.workflowId}`);
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
              <WorkflowPill type={workflowType} size="md" />
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
