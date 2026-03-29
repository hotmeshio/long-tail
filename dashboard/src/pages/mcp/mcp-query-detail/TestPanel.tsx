import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { WizardNav } from '../../../components/common/layout/WizardNav';
import { Modal } from '../../../components/common/modal/Modal';
import { useYamlWorkflow, useInvokeYamlWorkflow } from '../../../api/yaml-workflows';
import { useMcpRuns, useMcpRunExecution } from '../../../api/mcp-runs';
import { useWorkflowExecution } from '../../../api/workflows';
import { useTaskByWorkflowId } from '../../../api/tasks';
import { useYamlActivityEvents } from '../../../hooks/useYamlActivityEvents';
import { buildSkeleton } from '../../workflows/yaml-workflow-detail/helpers';
import type { LTJob, ActivityManifestEntry } from '../../../api/types';
import { extractJsonFromSummary } from './helpers';
import { SectionHeading } from './SectionHeading';

function jobLabel(job: LTJob): string {
  const date = new Date(job.created_at);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const status = job.status === 'completed' || Number(job.status) === 0 ? 'completed' : job.is_live ? 'running' : 'failed';
  return `${day} ${time} — ${status}`;
}

interface TestPanelProps {
  yamlId: string;
  originalWorkflowId: string | undefined;
  originalResult: Record<string, unknown> | undefined;
  originalPrompt: string | undefined;
  onBack: () => void;
  onAdvance: () => void;
}

export function TestPanel({ yamlId, originalWorkflowId, originalResult, originalPrompt, onBack, onAdvance }: TestPanelProps) {
  const queryClient = useQueryClient();
  const { data: wf } = useYamlWorkflow(yamlId);
  const invokeMutation = useInvokeYamlWorkflow();

  const { data: runs } = useMcpRuns({
    entity: wf?.graph_topic, app_id: wf?.app_id || 'longtail', limit: 10,
  });

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { data: selectedRunExecution } = useMcpRunExecution(
    selectedRunId ?? '', wf?.app_id || 'longtail',
  );

  // Invoke modal state
  const [showInvokeModal, setShowInvokeModal] = useState(false);
  const [invokeJsonMode, setInvokeJsonMode] = useState(false);
  const [invokeFields, setInvokeFields] = useState<Record<string, any>>({});
  const [invokeJson, setInvokeJson] = useState('{}');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const { steps: activitySteps, isComplete: jobComplete } = useYamlActivityEvents(activeJobId);

  // Original execution + task envelope
  const { data: originalExecution } = useWorkflowExecution(originalWorkflowId ?? '');
  const { data: originalTask } = useTaskByWorkflowId(originalWorkflowId ?? '');
  const originalExecResult = (originalExecution?.result as any)?.data as Record<string, unknown> | undefined;

  const originalEnvelope = useMemo(() => {
    if (!originalTask?.envelope) return null;
    try { return typeof originalTask.envelope === 'string' ? JSON.parse(originalTask.envelope) : originalTask.envelope; }
    catch { return null; }
  }, [originalTask?.envelope]);

  const resolvedPrompt = (originalEnvelope as any)?.data?.prompt ?? originalPrompt;

  const jobs = runs?.jobs ?? [];
  useEffect(() => {
    if (!selectedRunId && jobs.length > 0) setSelectedRunId(jobs[0].workflow_id);
  }, [jobs.length]);

  // Build form skeleton from input schema
  useEffect(() => {
    if (wf?.input_schema) {
      const skeleton = buildSkeleton(wf.input_schema);
      setInvokeFields(skeleton);
      setInvokeJson(JSON.stringify(skeleton, null, 2));
    }
  }, [wf?.id]);

  const handleInvoke = async () => {
    if (!wf) return;
    try {
      const data = invokeJsonMode ? JSON.parse(invokeJson) : invokeFields;
      const result = await invokeMutation.mutateAsync({ id: wf.id, data, sync: false });
      if (result.job_id) {
        setActiveJobId(result.job_id);
      }
    } catch { /* error shown in modal */ }
  };

  // When job completes via NATS events, dismiss modal and select the new run
  useEffect(() => {
    if (jobComplete && activeJobId) {
      const completedJobId = activeJobId;
      const timer = setTimeout(() => {
        setShowInvokeModal(false);
        setActiveJobId(null);
        setSelectedRunId(completedJobId);
        queryClient.invalidateQueries({ queryKey: ['mcpRuns'], refetchType: 'all' });
      }, 1000); // brief pause to show final completed state
      return () => clearTimeout(timer);
    }
  }, [jobComplete, activeJobId, queryClient]);

  if (!wf) return <p className="text-sm text-text-secondary animate-pulse">Loading...</p>;

  // Original output
  const originalOutput = originalExecResult?.result ??
    (typeof originalExecResult?.summary === 'string' ? extractJsonFromSummary(originalExecResult.summary) : null) ??
    originalResult?.result ??
    (typeof originalResult?.summary === 'string' ? extractJsonFromSummary(originalResult.summary) : null) ??
    originalResult;

  // Deterministic run data
  let deterministicOutput: unknown = null;
  let deterministicInput: unknown = null;
  if (selectedRunExecution?.result) {
    const execResult = selectedRunExecution.result as Record<string, unknown>;
    if (typeof execResult.response === 'string') {
      const jsonMatch = (execResult.response as string).match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try { deterministicOutput = JSON.parse(jsonMatch[1].trim()); } catch { deterministicOutput = execResult; }
      } else {
        deterministicOutput = extractJsonFromSummary(execResult.response as string) ?? execResult;
      }
    } else {
      deterministicOutput = execResult;
    }
  }
  if (selectedRunExecution?.events?.length) {
    const triggerEvent = selectedRunExecution.events.find(
      (e) => e.event_type === 'activity_task_completed' && e.is_system &&
        (e.attributes as any)?.result && Object.keys((e.attributes as any).result).length > 0,
    );
    deterministicInput = triggerEvent ? (triggerEvent.attributes as any).result : null;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-light text-text-primary">Compare Runs</h2>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs font-mono text-text-secondary">{wf.name}</span>
          <span className="text-[10px] text-text-tertiary">v{wf.content_version}</span>
          <Link to={`/mcp/workflows/${yamlId}`} className="text-[10px] text-accent hover:underline">View workflow</Link>
        </div>
      </div>

      {/* Grid-aligned comparison: column headers */}
      <div className="grid grid-cols-2 gap-8 mb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Original MCP Query</p>
          <p className="text-[10px] text-text-tertiary mt-0.5">Dynamic LLM orchestration</p>
        </div>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Deterministic Run</p>
            {jobs.length > 0 && selectedRunId && (
              <select
                value={selectedRunId}
                onChange={(e) => setSelectedRunId(e.target.value)}
                className="mt-0.5 bg-transparent border-none text-[10px] text-accent hover:text-accent/80 cursor-pointer focus:outline-none -ml-1 p-0"
              >
                {jobs.map((job) => <option key={job.workflow_id} value={job.workflow_id}>{jobLabel(job)}</option>)}
              </select>
            )}
            {!selectedRunId && <p className="text-[10px] text-text-tertiary mt-0.5">No runs yet</p>}
          </div>
          <button
            onClick={() => setShowInvokeModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors shrink-0"
          >
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9l7.5-4.5z" /></svg>
            Run Test
          </button>
        </div>
      </div>

      {/* Row 1: Inputs */}
      <SectionHeading>Input</SectionHeading>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-6">
        <div>
          {originalEnvelope ? (
            <JsonViewer data={originalEnvelope} defaultMode="tree" />
          ) : resolvedPrompt ? (
            <p className="text-xs text-text-primary leading-relaxed px-3 py-2 bg-surface-sunken rounded-md">{resolvedPrompt}</p>
          ) : (
            <p className="text-xs text-text-tertiary italic">Loading...</p>
          )}
        </div>
        <div>
          {deterministicInput ? (
            <JsonViewer data={deterministicInput} defaultMode="tree" />
          ) : selectedRunId && wf.input_schema ? (
            <div>
              <p className="text-[10px] text-text-tertiary italic mb-1">Stored defaults</p>
              <JsonViewer data={wf.input_schema} defaultMode="tree" />
            </div>
          ) : (
            <p className="text-xs text-text-tertiary italic">No runs yet</p>
          )}
        </div>
      </div>

      {/* Row 2: Outputs */}
      <SectionHeading>Output</SectionHeading>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-6">
        <div>
          {originalOutput ? (
            <JsonViewer data={originalOutput} defaultMode="tree" />
          ) : (
            <p className="text-xs text-text-tertiary italic">No output</p>
          )}
          {originalExecution?.duration_ms != null && (
            <p className="text-[10px] text-text-tertiary mt-2">{(originalExecution.duration_ms / 1000).toFixed(1)}s</p>
          )}
        </div>
        <div>
          {deterministicOutput ? (
            <JsonViewer data={deterministicOutput} defaultMode="tree" />
          ) : selectedRunId ? (
            <p className="text-xs text-text-tertiary animate-pulse">Loading...</p>
          ) : (
            <p className="text-xs text-text-tertiary italic">No runs yet</p>
          )}
          {selectedRunExecution?.duration_ms != null && (
            <p className="text-[10px] text-text-tertiary mt-2">{(selectedRunExecution.duration_ms / 1000).toFixed(1)}s</p>
          )}
        </div>
      </div>

      {/* Invoke modal with form/JSON toggle or live timeline */}
      <Modal
        open={showInvokeModal}
        onClose={() => { if (!activeJobId) { setShowInvokeModal(false); } }}
        title={activeJobId ? 'Executing...' : 'Test Deterministic Workflow'}
        maxWidth="max-w-lg"
      >
        {activeJobId ? (
          /* ── Live execution timeline ── */
          <LiveActivityTimeline
            steps={activitySteps}
            manifest={wf.activity_manifest}
            isComplete={jobComplete}
          />
        ) : (
          /* ── Input form ── */
          <>
            <p className="text-xs text-text-secondary mb-3 leading-relaxed">
              Invoke <span className="font-mono text-text-primary">{wf.name}</span> with explicit inputs.
            </p>

            <div className="flex justify-end mb-2">
              <button onClick={() => {
                if (!invokeJsonMode) setInvokeJson(JSON.stringify(invokeFields, null, 2));
                else try { setInvokeFields(JSON.parse(invokeJson)); } catch { /* keep fields */ }
                setInvokeJsonMode(!invokeJsonMode);
              }} className="text-[10px] text-accent hover:underline">
                {invokeJsonMode ? 'Form view' : 'JSON view'}
              </button>
            </div>

            {invokeJsonMode ? (
              <textarea
                value={invokeJson}
                onChange={(e) => setInvokeJson(e.target.value)}
                className="w-full min-h-[200px] px-3 py-2 bg-surface-sunken border border-surface-border rounded-md font-mono text-xs text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
              />
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {Object.entries(invokeFields).map(([key, value]) => (
                  <div key={key}>
                    <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">{key}</label>
                    {typeof value === 'boolean' ? (
                      <select
                        value={String(value)}
                        onChange={(e) => setInvokeFields({ ...invokeFields, [key]: e.target.value === 'true' })}
                        className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : typeof value === 'object' ? (
                      <textarea
                        value={JSON.stringify(value, null, 2)}
                        onChange={(e) => { try { setInvokeFields({ ...invokeFields, [key]: JSON.parse(e.target.value) }); } catch { /* invalid json */ } }}
                        className="w-full min-h-[60px] px-3 py-1.5 bg-surface-sunken border border-surface-border rounded-md font-mono text-xs text-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                      />
                    ) : (
                      <input
                        type={typeof value === 'number' ? 'number' : 'text'}
                        value={String(value ?? '')}
                        onChange={(e) => setInvokeFields({ ...invokeFields, [key]: typeof value === 'number' ? Number(e.target.value) : e.target.value })}
                        className="w-full bg-surface-sunken border border-surface-border rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {invokeMutation.isError && (
              <p className="mt-2 text-xs text-status-error">{invokeMutation.error.message}</p>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <button onClick={() => setShowInvokeModal(false)} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
              <button onClick={handleInvoke} disabled={invokeMutation.isPending} className="btn-primary text-xs">
                {invokeMutation.isPending ? 'Starting...' : 'Invoke'}
              </button>
            </div>
          </>
        )}
      </Modal>

      <WizardNav>
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
        <button onClick={onAdvance} className="btn-primary text-xs">Next: Verify</button>
      </WizardNav>
    </div>
  );
}

// ── Live activity timeline shown inside the invoke modal ──────────────────

const TOOL_SOURCE_COLORS: Record<string, { border: string; text: string; icon: string }> = {
  mcp:       { border: 'border-blue-500', text: 'text-blue-500', icon: 'MCP' },
  db:        { border: 'border-blue-500', text: 'text-blue-500', icon: 'DB' },
  llm:       { border: 'border-violet-500', text: 'text-violet-500', icon: 'LLM' },
  transform: { border: 'border-emerald-500', text: 'text-emerald-500', icon: 'Map' },
};

function LiveActivityTimeline({
  steps,
  manifest,
  isComplete,
}: {
  steps: import('../../../hooks/useYamlActivityEvents').ActivityStep[];
  manifest: ActivityManifestEntry[];
  isComplete: boolean;
}) {
  // Build the full skeleton from manifest, overlay live step status
  const workerActivities = manifest.filter((a) => a.type === 'worker');
  const totalSteps = workerActivities.length;

  const merged = workerActivities.map((a, i) => {
    const live = steps.find((s) => s.activityId === a.activity_id);
    const source = a.tool_source || 'mcp';
    const colors = TOOL_SOURCE_COLORS[source] || TOOL_SOURCE_COLORS.mcp;
    return {
      activityId: a.activity_id,
      title: a.title || a.mcp_tool_name || a.activity_id,
      toolName: a.mcp_tool_name,
      toolSource: source,
      colors,
      stepIndex: i,
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
              {/* Vertical track */}
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

              {/* Step content */}
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

      {isComplete && (
        <p className="text-[10px] text-text-tertiary mt-3 text-center">Closing...</p>
      )}
    </div>
  );
}
