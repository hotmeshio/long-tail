import { useState, useEffect } from 'react';
import { Modal } from '../../../components/common/Modal';
import { getResolverTemplate } from '../../../lib/templates';

interface ResolveModalProps {
  open: boolean;
  onClose: () => void;
  workflowType: string | null;
  onResolve: (payload: Record<string, unknown>) => void;
  isPending: boolean;
  error?: Error | null;
}

export function ResolveModal({ open, onClose, workflowType, onResolve, isPending, error }: ResolveModalProps) {
  const [resolverJson, setResolverJson] = useState('{}');
  const [resolveError, setResolveError] = useState('');
  const [requestTriage, setRequestTriage] = useState(false);
  const [triageHint, setTriageHint] = useState('');

  // Pre-fill resolver JSON when workflow type is available
  useEffect(() => {
    if (workflowType) {
      setResolverJson(getResolverTemplate(workflowType));
    }
  }, [workflowType]);

  const handleResolve = () => {
    setResolveError('');
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(resolverJson);
    } catch {
      setResolveError('Invalid JSON');
      return;
    }

    // Inject _lt triage routing when requested
    if (requestTriage) {
      payload._lt = {
        needsTriage: true,
        ...(triageHint ? { hint: triageHint } : {}),
      };
    }

    onResolve(payload);
  };

  return (
    <Modal open={open} onClose={onClose} title="Resolve Escalation">
      <div className="space-y-4">
        {workflowType && (
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <span className="font-mono bg-surface-sunken px-2 py-0.5 rounded">
              {workflowType}
            </span>
            <span>resolver payload</span>
          </div>
        )}

        <textarea
          value={resolverJson}
          onChange={(e) => setResolverJson(e.target.value)}
          className="input font-mono text-xs"
          rows={10}
          spellCheck={false}
        />

        {/* AI Triage toggle */}
        <div className="border-t pt-3 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={requestTriage}
              onChange={(e) => setRequestTriage(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-accent"
            />
            <div>
              <p className="text-xs font-medium text-text-primary">
                Request AI Triage
              </p>
              <p className="text-[10px] text-text-tertiary">
                Route to the MCP triage orchestrator for AI-assisted remediation
              </p>
            </div>
          </label>

          {requestTriage && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
                Triage Hint (optional)
              </label>
              <input
                type="text"
                value={triageHint}
                onChange={(e) => setTriageHint(e.target.value)}
                placeholder="e.g., image_orientation"
                className="input text-xs font-mono w-full"
              />
              <p className="text-[10px] text-text-tertiary mt-1">
                Guides the triage workflow on what remediation to apply
              </p>
            </div>
          )}
        </div>

        {resolveError && (
          <p className="text-xs text-status-error">{resolveError}</p>
        )}
        {error && (
          <p className="text-xs text-status-error">{error.message}</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Cancel
          </button>
          <button onClick={handleResolve} className="btn-primary text-xs" disabled={isPending}>
            {isPending ? 'Resolving...' : requestTriage ? 'Resolve & Triage' : 'Resolve'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
