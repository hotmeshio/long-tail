import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';

import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { WizardNav } from '../../../components/common/layout/WizardNav';
import { useSubmitMcpQueryRouted, useMcpQueryExecution, useMcpQueryResult } from '../../../api/mcp-query';
import { useTaskByWorkflowId } from '../../../api/tasks';

interface VerifyPanelProps {
  originalWorkflowId: string | undefined;
  originalPrompt: string | undefined;
  workflowName: string;
  onBack: () => void;
  onGoToDeploy: () => void;
}

export function VerifyPanel({ originalWorkflowId, originalPrompt, workflowName, onBack, onGoToDeploy }: VerifyPanelProps) {
  const submitQuery = useSubmitMcpQueryRouted();

  const [testPrompt, setTestPrompt] = useState('');
  const [verifyRunId, setVerifyRunId] = useState<string | null>(null);
  const [promptInitialized, setPromptInitialized] = useState(false);

  // Original prompt
  const { data: originalTask } = useTaskByWorkflowId(originalWorkflowId ?? '');
  const originalEnvelope = useMemo(() => {
    if (!originalTask?.envelope) return null;
    try { return typeof originalTask.envelope === 'string' ? JSON.parse(originalTask.envelope) : originalTask.envelope; }
    catch { return null; }
  }, [originalTask?.envelope]);
  const resolvedPrompt = (originalEnvelope as any)?.data?.prompt ?? originalPrompt;

  // Pre-fill prompt once
  if (resolvedPrompt && !promptInitialized) {
    setPromptInitialized(true);
    setTestPrompt(resolvedPrompt);
  }

  // Verify run
  const { data: verifyExecution } = useMcpQueryExecution(verifyRunId ?? undefined);
  const { data: verifyResult } = useMcpQueryResult(
    verifyExecution?.status === 'completed' ? verifyRunId ?? undefined : undefined,
  );

  const verifyStatus = verifyExecution?.status;
  const verifyData = (verifyResult?.result?.data ?? {}) as Record<string, unknown>;
  const verifyDiscovery = verifyData.discovery as Record<string, unknown> | undefined;
  const usedDeterministic = verifyDiscovery?.method === 'compiled-workflow';
  const isRunning = verifyRunId && verifyStatus !== 'completed' && verifyStatus !== 'failed';

  const handleSubmit = async () => {
    if (!testPrompt.trim()) return;
    const res = await submitQuery.mutateAsync({ prompt: testPrompt.trim() });
    setVerifyRunId(res.workflow_id);
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-light text-text-primary">End-to-End Verification</h2>
        <p className="text-xs text-text-tertiary mt-0.5">
          Submit the original prompt (or a variant) to verify that
          <span className="font-mono text-text-primary mx-1">{workflowName}</span>
          handles it deterministically.
          If results are unexpected, go <button onClick={onGoToDeploy} className="text-accent hover:underline">back</button> to adjust.
        </p>
      </div>

      {/* Row 1: Headers + metadata (aligned) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Query Prompt</p>
          <p className="text-[10px] text-text-tertiary">
            {testPrompt !== resolvedPrompt && resolvedPrompt
              ? <button onClick={() => setTestPrompt(resolvedPrompt)} className="text-accent hover:underline">Reset to original</button>
              : 'Edit and submit to verify'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Result</p>
          {!verifyRunId && (
            <p className="text-[10px] text-text-tertiary italic">Awaiting submission</p>
          )}
          {isRunning && (
            <div className="flex items-center gap-2">
              <StatusBadge status="in_progress" />
              <span className="text-[10px] text-text-secondary animate-pulse">Executing...</span>
            </div>
          )}
          {verifyStatus === 'failed' && (
            <div className="flex items-center gap-2">
              <StatusBadge status="failed" />
              <span className="text-[10px] text-status-error">Failed</span>
            </div>
          )}
          {verifyStatus === 'completed' && (
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status="completed" />
              {usedDeterministic ? (
                <span className="text-[10px] bg-status-success/10 text-status-success px-2 py-0.5 rounded-full">
                  Deterministic ({((verifyDiscovery?.confidence as number) * 100).toFixed(0)}%)
                </span>
              ) : (
                <span className="text-[10px] bg-status-pending/10 text-status-pending px-2 py-0.5 rounded-full">
                  Dynamic (no match)
                </span>
              )}
              {verifyExecution?.duration_ms != null && (
                <span className="text-[10px] text-text-tertiary">{(verifyExecution.duration_ms / 1000).toFixed(1)}s</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Prompt input + output (aligned) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: editable prompt */}
        <div>
          <textarea
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            className="w-full min-h-[160px] px-3 py-2 bg-surface-sunken border border-surface-border rounded-md text-xs text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
            placeholder="Type a natural language query..."
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={handleSubmit}
              disabled={!testPrompt.trim() || submitQuery.isPending || !!isRunning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9l7.5-4.5z" /></svg>
              {submitQuery.isPending ? 'Starting...' : isRunning ? 'Running...' : verifyRunId ? 'Resubmit' : 'Submit'}
            </button>
          </div>
        </div>

        {/* Right: output */}
        <div>
          {!verifyRunId && (
            <div className="flex items-center justify-center min-h-[160px] text-xs text-text-tertiary italic">
              Submit a query to see the result
            </div>
          )}

          {isRunning && (
            <div className="flex items-center justify-center min-h-[160px]">
              <p className="text-xs text-text-secondary animate-pulse">Executing query...</p>
            </div>
          )}

          {verifyStatus === 'completed' && (
            <div className="space-y-3">
              {typeof verifyData.title === 'string' && (
                <p className="text-sm text-text-primary">{verifyData.title}</p>
              )}
              {verifyData.result != null && (
                <JsonViewer data={verifyData.result} defaultMode="tree" />
              )}
              <div className="flex items-center gap-3 pt-1">
                <Link to={`/mcp/queries/${verifyRunId}`} className="text-[10px] text-accent hover:underline">
                  View full details
                </Link>
                <button onClick={() => setVerifyRunId(null)} className="text-[10px] text-text-tertiary hover:text-text-primary">
                  Clear
                </button>
              </div>
            </div>
          )}

          {verifyStatus === 'failed' && (
            <p className="text-xs text-status-error py-4">Query failed. Try modifying the prompt.</p>
          )}
        </div>
      </div>

      <WizardNav>
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
        <span className="text-[10px] text-text-tertiary">End-to-end verification — modify the prompt and submit to test the full pipeline</span>
      </WizardNav>
    </div>
  );
}
