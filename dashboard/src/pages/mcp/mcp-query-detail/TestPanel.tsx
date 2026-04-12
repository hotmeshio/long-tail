import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

import { JsonViewer } from '../../../components/common/data/JsonViewer';
import { WizardNav } from '../../../components/common/layout/WizardNav';
import { useYamlWorkflow } from '../../../api/yaml-workflows';
import { useMcpRuns, useMcpRunExecution } from '../../../api/mcp-runs';
import { useWorkflowExecution } from '../../../api/workflows';
import { useTaskByWorkflowId } from '../../../api/tasks';
import type { LTJob } from '../../../api/types';
import { extractJsonFromSummary } from './helpers';
import { SectionHeading } from './SectionHeading';
import { InvokeModal } from './InvokeModal';

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
  const { data: wf } = useYamlWorkflow(yamlId);

  const { data: runs } = useMcpRuns({
    entity: wf?.graph_topic, app_id: wf?.app_id || 'longtail', limit: 10,
  });

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { data: selectedRunExecution } = useMcpRunExecution(
    selectedRunId ?? '', wf?.app_id || 'longtail',
  );

  const [showInvokeModal, setShowInvokeModal] = useState(false);

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
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Compiled Pipeline Run</p>
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

      <InvokeModal
        open={showInvokeModal}
        onClose={() => setShowInvokeModal(false)}
        workflow={wf}
        onJobCompleted={(jobId) => setSelectedRunId(jobId)}
      />

      <WizardNav>
        <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
        <button onClick={onAdvance} className="btn-primary text-xs">Next: Verify</button>
      </WizardNav>
    </div>
  );
}
