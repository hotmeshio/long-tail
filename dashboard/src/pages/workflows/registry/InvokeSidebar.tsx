import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import type { LTWorkflowConfig } from '../../../api/types';

interface InvokeSidebarProps {
  invokeJson: string;
  setInvokeJson: (v: string) => void;
  invokeParseError: string;
  setInvokeParseError: (v: string) => void;
  invokeMutation: { error: Error | null; isSuccess: boolean; isPending: boolean };
  onInvoke: () => void;
  editing: LTWorkflowConfig;
}

export function InvokeSidebar({
  invokeJson,
  setInvokeJson,
  invokeParseError,
  setInvokeParseError,
  invokeMutation,
  onInvoke,
  editing,
}: InvokeSidebarProps) {
  return (
    <div className="lg:border-l lg:border-surface-border lg:pl-12">
      <SectionLabel className="mb-6">Invoke</SectionLabel>

      <div className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <label className="block text-xs text-text-secondary">Envelope</label>
            {editing?.envelope_schema ? (
              <span className="text-[10px] text-accent">Pre-filled from config</span>
            ) : (
              <span className="text-[10px] text-status-warning">No template</span>
            )}
          </div>
          <textarea
            value={invokeJson}
            onChange={(e) => {
              setInvokeJson(e.target.value);
              setInvokeParseError('');
            }}
            className="input font-mono text-[11px] w-full leading-relaxed"
            rows={10}
            spellCheck={false}
          />
          <p className="text-[10px] text-text-tertiary mt-1.5">
            <code className="text-accent/80">data</code> holds workflow input; <code className="text-accent/80">metadata</code> is optional context.
          </p>
        </div>

        {invokeParseError && (
          <p className="text-xs text-status-error">{invokeParseError}</p>
        )}
        {invokeMutation.error && (
          <p className="text-xs text-status-error">
            {(invokeMutation.error as Error).message}
          </p>
        )}
        {invokeMutation.isSuccess && (
          <p className="text-xs text-status-success">Workflow started</p>
        )}

        <button
          onClick={onInvoke}
          disabled={invokeMutation.isPending}
          className="btn-primary text-xs w-full"
        >
          {invokeMutation.isPending ? 'Starting...' : 'Start Workflow'}
        </button>
      </div>
    </div>
  );
}
