import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Play, RotateCcw, ExternalLink } from 'lucide-react';

import { Modal } from '../../../components/common/modal/Modal';
import { useInvokeYamlWorkflow } from '../../../api/yaml-workflows';
import { useYamlActivityEvents } from '../../../hooks/useYamlActivityEvents';
import type { LTYamlWorkflowRecord, ActivityManifestEntry } from '../../../api/types';
import { buildSkeleton } from './helpers';

// ── Tool source colors (matches TestPanel pattern) ───────────────────────────

const TOOL_SOURCE_COLORS: Record<string, { border: string; text: string; icon: string }> = {
  mcp:       { border: 'border-blue-500', text: 'text-blue-500', icon: 'MCP' },
  db:        { border: 'border-blue-500', text: 'text-blue-500', icon: 'DB' },
  llm:       { border: 'border-violet-500', text: 'text-violet-500', icon: 'LLM' },
  transform: { border: 'border-emerald-500', text: 'text-emerald-500', icon: 'Map' },
};

// ── Live timeline ────────────────────────────────────────────────────────────

function LiveTimeline({
  steps,
  manifest,
  isComplete,
}: {
  steps: import('../../../hooks/useYamlActivityEvents').ActivityStep[];
  manifest: ActivityManifestEntry[];
  isComplete: boolean;
}) {
  const workerActivities = manifest.filter((a) => a.type === 'worker');
  const totalSteps = workerActivities.length;

  const merged = workerActivities.map((a) => {
    const live = steps.find((s) => s.activityId === a.activity_id);
    const source = a.tool_source || 'mcp';
    const colors = TOOL_SOURCE_COLORS[source] || TOOL_SOURCE_COLORS.mcp;
    return {
      activityId: a.activity_id,
      title: a.title || a.mcp_tool_name || a.activity_id,
      toolName: a.mcp_tool_name,
      colors,
      status: live?.status || 'pending' as const,
      error: live?.error,
    };
  });

  return (
    <div>
      <p className="text-xs text-text-secondary mb-4">
        {isComplete
          ? `All ${totalSteps} steps completed`
          : `Running step ${merged.filter((s) => s.status === 'completed').length + 1} of ${totalSteps}...`}
      </p>
      <div className="space-y-0">
        {merged.map((step, idx) => {
          const isLast = idx === merged.length - 1;
          return (
            <div key={step.activityId} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center w-5 shrink-0">
                <span className={`w-3 h-3 rounded-full shrink-0 border-2 transition-colors ${
                  step.status === 'completed' ? 'bg-status-success border-status-success'
                  : step.status === 'running' ? `${step.colors.border} bg-transparent animate-pulse`
                  : step.status === 'failed' ? 'bg-status-error border-status-error'
                  : 'bg-surface-sunken border-surface-border'
                }`} />
                {!isLast && (
                  <span className={`w-px flex-1 transition-colors ${
                    step.status === 'completed' ? 'bg-status-success/30' : 'bg-surface-border'
                  }`} />
                )}
              </div>
              <div className={`pb-4 ${isLast ? 'pb-0' : ''}`}>
                <p className={`text-xs font-medium ${
                  step.status === 'running' ? 'text-text-primary'
                  : step.status === 'completed' ? 'text-text-secondary'
                  : step.status === 'failed' ? 'text-status-error'
                  : 'text-text-tertiary'
                }`}>
                  {step.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[9px] font-mono px-1 py-0.5 rounded border ${step.colors.border} ${step.colors.text} bg-transparent`}>
                    {step.colors.icon}
                  </span>
                  {step.toolName && (
                    <span className="text-[10px] text-text-tertiary font-mono">{step.toolName}</span>
                  )}
                </div>
                {step.error && (
                  <p className="text-[10px] text-status-error mt-1">{step.error}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

interface TryWorkflowModalProps {
  open: boolean;
  onClose: () => void;
  workflow: LTYamlWorkflowRecord;
}

export function TryWorkflowModal({ open, onClose, workflow }: TryWorkflowModalProps) {
  const invokeMutation = useInvokeYamlWorkflow();
  const [argsJson, setArgsJson] = useState(() =>
    JSON.stringify(buildSkeleton(workflow.input_schema), null, 2),
  );
  const [jsonError, setJsonError] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<{ jobId: string; data: unknown } | null>(null);
  const { steps, isComplete } = useYamlActivityEvents(activeJobId);

  // Reset state when modal opens with a new workflow
  useEffect(() => {
    if (open) {
      setActiveJobId(null);
      setCompletedResult(null);
      setJsonError('');
      invokeMutation.reset();
      setArgsJson(JSON.stringify(buildSkeleton(workflow.input_schema), null, 2));
    }
  }, [open, workflow.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When job completes, transition from timeline to result view
  useEffect(() => {
    if (isComplete && activeJobId) {
      const jobId = activeJobId;
      const timer = setTimeout(() => {
        setCompletedResult({ jobId, data: null });
        setActiveJobId(null);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isComplete, activeJobId]);

  const handleRun = async () => {
    setJsonError('');
    setCompletedResult(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(argsJson);
    } catch {
      setJsonError('Invalid JSON');
      return;
    }
    try {
      const result = await invokeMutation.mutateAsync({ id: workflow.id, data: parsed, sync: false });
      if (result.job_id) {
        setActiveJobId(result.job_id);
      }
    } catch { /* error shown in modal */ }
  };

  const isRunning = !!activeJobId;
  const ns = workflow.app_id || 'longtail';

  return (
    <Modal
      open={open}
      onClose={() => { if (!isRunning) onClose(); }}
      title={isRunning ? 'Executing...' : `Try ${workflow.graph_topic}`}
      maxWidth="max-w-lg"
    >
      {isRunning ? (
        /* ── Live timeline ── */
        <LiveTimeline
          steps={steps}
          manifest={workflow.activity_manifest}
          isComplete={isComplete}
        />
      ) : completedResult ? (
        /* ── Completed result ── */
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-status-success" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.36 4.65a.5.5 0 00-.72 0L7 9.29 5.36 7.65a.5.5 0 10-.72.7l2 2a.5.5 0 00.72 0l4-4a.5.5 0 000-.7z" />
            </svg>
            <p className="text-xs font-medium text-status-success">Workflow completed</p>
          </div>

          <Link
            to={`/mcp/executions/${encodeURIComponent(completedResult.jobId)}?namespace=${encodeURIComponent(ns)}`}
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
          >
            <ExternalLink size={12} />
            View execution details
          </Link>

          <div className="flex justify-end gap-3 pt-2 border-t border-surface-border">
            <button onClick={onClose} className="btn-ghost text-xs">Close</button>
            <button
              onClick={() => { setCompletedResult(null); }}
              className="btn-primary text-xs inline-flex items-center gap-1.5"
            >
              <RotateCcw size={12} /> Run again
            </button>
          </div>
        </div>
      ) : (
        /* ── Input form ── */
        <div className="flex flex-col gap-4">
          {workflow.description && (
            <p className="text-xs text-text-secondary">{workflow.description}</p>
          )}

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
              Input
            </label>
            <textarea
              value={argsJson}
              onChange={(e) => setArgsJson(e.target.value)}
              className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
              rows={8}
              spellCheck={false}
            />
            {jsonError && <p className="text-xs text-status-error mt-1">{jsonError}</p>}
          </div>

          {invokeMutation.isError && (
            <div className="bg-status-error/10 border border-status-error/20 rounded-md px-3 py-2">
              <p className="text-xs text-status-error">
                {invokeMutation.error instanceof Error ? invokeMutation.error.message : 'Invocation failed'}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-surface-border">
            <button onClick={onClose} className="btn-ghost text-xs">Close</button>
            <button
              onClick={handleRun}
              disabled={invokeMutation.isPending}
              className="btn-primary text-xs disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {invokeMutation.isPending ? 'Starting...' : <><Play size={12} /> Run</>}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
