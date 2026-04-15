import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Play, RotateCcw, ExternalLink } from 'lucide-react';
import { useInvokeYamlWorkflow } from '../../../api/yaml-workflows';
import { useYamlActivityEvents, type ActivityStep } from '../../../hooks/useYamlActivityEvents';
import { RunAsSelector } from '../form/RunAsSelector';
import type { LTYamlWorkflowRecord, ActivityManifestEntry } from '../../../api/types';
import { buildSkeleton } from '../../../pages/mcp/mcp-query-detail/helpers';

const TOOL_SOURCE_COLORS: Record<string, { border: string; text: string; icon: string }> = {
  mcp:       { border: 'border-blue-500', text: 'text-blue-500', icon: 'MCP' },
  db:        { border: 'border-blue-500', text: 'text-blue-500', icon: 'DB' },
  llm:       { border: 'border-violet-500', text: 'text-violet-500', icon: 'LLM' },
  transform: { border: 'border-emerald-500', text: 'text-emerald-500', icon: 'Map' },
};

function LiveTimeline({ steps, manifest, isComplete }: {
  steps: ActivityStep[];
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
      <p className="text-[11px] text-text-secondary mb-3">
        {isComplete
          ? `All ${totalSteps} steps completed`
          : `Running step ${merged.filter((s) => s.status === 'completed').length + 1} of ${totalSteps}...`}
      </p>
      <div className="space-y-0">
        {merged.map((step, idx) => {
          const isLast = idx === merged.length - 1;
          return (
            <div key={step.activityId} className="flex items-stretch gap-2">
              <div className="flex flex-col items-center w-4 shrink-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 border-2 transition-colors ${
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
              <div className={isLast ? '' : 'pb-3'}>
                <p className={`text-[11px] font-medium ${
                  step.status === 'running' ? 'text-text-primary'
                  : step.status === 'completed' ? 'text-text-secondary'
                  : step.status === 'failed' ? 'text-status-error'
                  : 'text-text-tertiary'
                }`}>{step.title}</p>
                {step.toolName && (
                  <span className="text-[9px] text-text-tertiary font-mono">{step.toolName}</span>
                )}
                {step.error && (
                  <p className="text-[9px] text-status-error mt-0.5">{step.error}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface WorkflowTestPanelProps {
  workflow: LTYamlWorkflowRecord;
  onClose: () => void;
}

export function WorkflowTestPanel({ workflow, onClose }: WorkflowTestPanelProps) {
  const invokeMutation = useInvokeYamlWorkflow();
  const [jsonMode, setJsonMode] = useState(false);
  const [fields, setFields] = useState<Record<string, any>>({});
  const [argsJson, setArgsJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [executeAs, setExecuteAs] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<{ jobId: string } | null>(null);
  const { steps, isComplete } = useYamlActivityEvents(activeJobId);

  useEffect(() => {
    setActiveJobId(null);
    setCompletedResult(null);
    setJsonError('');
    invokeMutation.reset();
    const skeleton = buildSkeleton(workflow.input_schema);
    setFields(skeleton);
    setArgsJson(JSON.stringify(skeleton, null, 2));
    setJsonMode(false);
  }, [workflow.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isComplete && activeJobId) {
      const jobId = activeJobId;
      const timer = setTimeout(() => {
        setCompletedResult({ jobId });
        setActiveJobId(null);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isComplete, activeJobId]);

  const toggleMode = () => {
    if (!jsonMode) {
      setArgsJson(JSON.stringify(fields, null, 2));
    } else {
      try { setFields(JSON.parse(argsJson)); } catch { /* keep fields */ }
    }
    setJsonMode(!jsonMode);
  };

  const handleRun = async () => {
    setJsonError('');
    setCompletedResult(null);
    let parsed: Record<string, unknown>;
    if (jsonMode) {
      try { parsed = JSON.parse(argsJson); } catch { setJsonError('Invalid JSON'); return; }
    } else {
      parsed = { ...fields };
    }
    try {
      const result = await invokeMutation.mutateAsync({
        id: workflow.id,
        data: parsed,
        sync: false,
        ...(executeAs ? { execute_as: executeAs } : {}),
      });
      if (result.job_id) setActiveJobId(result.job_id);
    } catch { /* error shown in panel */ }
  };

  const isRunning = !!activeJobId;
  const ns = workflow.app_id || 'longtail';

  return (
    <div className="border-l border-surface-border bg-surface-raised flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">{workflow.app_id}</p>
          <code className="text-[11px] font-mono text-accent truncate block">{workflow.graph_topic}</code>
        </div>
        <button onClick={() => { if (!isRunning) onClose(); }} className="p-1 text-text-tertiary hover:text-text-primary shrink-0 ml-2">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isRunning ? (
          <LiveTimeline steps={steps} manifest={workflow.activity_manifest} isComplete={isComplete} />
        ) : completedResult ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-status-success" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.36 4.65a.5.5 0 00-.72 0L7 9.29 5.36 7.65a.5.5 0 10-.72.7l2 2a.5.5 0 00.72 0l4-4a.5.5 0 000-.7z" />
              </svg>
              <p className="text-xs font-medium text-status-success">Workflow completed</p>
            </div>
            <div className="flex items-center justify-between">
              <Link
                to={`/mcp/executions/${encodeURIComponent(completedResult.jobId)}?namespace=${encodeURIComponent(ns)}`}
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
              >
                <ExternalLink size={12} /> View execution
              </Link>
              <button
                onClick={() => setCompletedResult(null)}
                className="btn-primary text-xs inline-flex items-center gap-1.5"
              >
                <RotateCcw size={12} /> Run again
              </button>
            </div>
          </div>
        ) : (
          <>
            <RunAsSelector selected={executeAs} onChange={setExecuteAs} />

            {workflow.description && (
              <p className="text-[11px] text-text-secondary leading-relaxed">{workflow.description}</p>
            )}

            {/* Form / JSON toggle input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Input</label>
                <button onClick={toggleMode} className="text-[10px] text-accent hover:underline">
                  {jsonMode ? 'Form view' : 'JSON view'}
                </button>
              </div>

              {jsonMode ? (
                <textarea
                  value={argsJson}
                  onChange={(e) => setArgsJson(e.target.value)}
                  className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-2 font-mono text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary resize-y"
                  rows={6}
                  spellCheck={false}
                />
              ) : (
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {Object.entries(fields).map(([key, value]) => (
                    <div key={key}>
                      <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">{key}</label>
                      {typeof value === 'boolean' ? (
                        <select
                          value={String(value)}
                          onChange={(e) => setFields({ ...fields, [key]: e.target.value === 'true' })}
                          className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : typeof value === 'object' ? (
                        <textarea
                          value={JSON.stringify(value, null, 2)}
                          onChange={(e) => { try { setFields({ ...fields, [key]: JSON.parse(e.target.value) }); } catch { /* invalid */ } }}
                          className="w-full min-h-[60px] px-3 py-1.5 bg-surface-sunken border border-surface-border rounded-md font-mono text-xs text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                        />
                      ) : (
                        <input
                          type={typeof value === 'number' ? 'number' : 'text'}
                          value={String(value ?? '')}
                          onChange={(e) => setFields({ ...fields, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })}
                          className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                        />
                      )}
                    </div>
                  ))}
                  {Object.keys(fields).length === 0 && (
                    <p className="text-[11px] text-text-tertiary italic">No input fields defined</p>
                  )}
                </div>
              )}
              {jsonError && <p className="text-[11px] text-status-error mt-1">{jsonError}</p>}
            </div>

            {invokeMutation.isError && (
              <div className="bg-status-error/10 border border-status-error/20 rounded-md px-3 py-2">
                <p className="text-[11px] text-status-error">
                  {invokeMutation.error instanceof Error ? invokeMutation.error.message : 'Invocation failed'}
                </p>
              </div>
            )}
            <button
              onClick={handleRun}
              disabled={invokeMutation.isPending}
              className="btn-primary text-xs disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {invokeMutation.isPending ? 'Starting...' : <><Play size={12} /> Run</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
