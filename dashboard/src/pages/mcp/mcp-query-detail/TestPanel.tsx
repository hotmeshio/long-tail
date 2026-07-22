import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { SecondaryAction } from '../../../components/common/display/SecondaryAction';
import { WizardNav } from '../../../components/common/layout/WizardNav';
import { useYamlWorkflow, useInvokeYamlWorkflow } from '../../../api/yaml-workflows';
import { useMcpRuns, useMcpRunExecution } from '../../../api/pipelines';
import { useWorkflowExecution } from '../../../api/workflows';
import { useTaskByWorkflowId } from '../../../api/tasks';
import { useYamlActivityEvents } from '../../../hooks/useYamlActivityEvents';
import { buildSkeleton, extractJsonFromSummary } from './helpers';
import { TestSidebar } from './TestSidebar';
import { TestResultsBuilder, TestResultsComparison } from './TestResults';

interface TestPanelProps {
  yamlId: string;
  originalWorkflowId: string | undefined;
  originalResult: Record<string, unknown> | undefined;
  originalPrompt: string | undefined;
  onBack: () => void;
  onAdvance: () => void;
  /** When true, hides the original MCP Query comparison column and shows input/output full-width. */
  builderMode?: boolean;
}

export function TestPanel({ yamlId, originalWorkflowId, originalResult, originalPrompt, onBack, onAdvance, builderMode }: TestPanelProps) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: wf } = useYamlWorkflow(yamlId);

  const { data: runs } = useMcpRuns({
    entity: wf?.graph_topic, app_id: wf?.app_id || '', limit: 10,
  });

  // Deep-linked run selection via ?run= param
  const runParam = searchParams.get('run');
  const setRunParam = (id: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('run', id); else next.delete('run');
      return next;
    }, { replace: true });
  };

  const [selectedRunId, setSelectedRunId] = useState<string | null>(runParam);
  const selectRun = (id: string | null) => {
    setSelectedRunId(id);
    setRunParam(id);
  };

  const { data: selectedRunExecution, isLoading: runLoading } = useMcpRunExecution(
    selectedRunId ?? '', wf?.app_id || '',
  );

  // Sidebar state: input form or live execution
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [invokeJsonMode, setInvokeJsonMode] = useState(false);
  const [invokeFields, setInvokeFields] = useState<Record<string, any>>({});
  const [invokeJson, setInvokeJson] = useState('{}');
  const [executeAs, setExecuteAs] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const invokeMutation = useInvokeYamlWorkflow();
  const { steps: activitySteps, isComplete: jobComplete } = useYamlActivityEvents(activeJobId);

  // Initialize form fields from input schema
  useEffect(() => {
    if (wf?.input_schema) {
      const skeleton = buildSkeleton(wf.input_schema);
      setInvokeFields(skeleton);
      setInvokeJson(JSON.stringify(skeleton, null, 2));
    }
  }, [wf?.id]);

  // Auto-select first run if no deep-link and no selection
  const jobs = runs?.jobs ?? [];
  useEffect(() => {
    if (!selectedRunId && !runParam && jobs.length > 0) {
      selectRun(jobs[0].workflow_id);
    }
  }, [jobs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore deep-linked run
  useEffect(() => {
    if (runParam && !selectedRunId) setSelectedRunId(runParam);
  }, [runParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // When job completes, switch to viewing it and close sidebar
  useEffect(() => {
    if (jobComplete && activeJobId) {
      const completedId = activeJobId;
      const timer = setTimeout(() => {
        selectRun(completedId);
        setActiveJobId(null);
        setSidebarOpen(false);
        queryClient.invalidateQueries({ queryKey: ['mcpRuns'], refetchType: 'all' });
        queryClient.invalidateQueries({ queryKey: ['mcpRunExecution', completedId], refetchType: 'all' });
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [jobComplete, activeJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInvoke = async () => {
    if (!wf) return;
    try {
      const data = invokeJsonMode ? JSON.parse(invokeJson) : invokeFields;
      const result = await invokeMutation.mutateAsync({
        id: wf.id, data, sync: false,
        ...(executeAs ? { execute_as: executeAs } : {}),
      });
      if (result.job_id) {
        setActiveJobId(result.job_id);
        selectRun(result.job_id);
      }
    } catch { /* error shown in sidebar */ }
  };

  const handleOpenSidebar = () => {
    setActiveJobId(null);
    setSidebarOpen(true);
  };

  // Original execution + task envelope (only used in non-builder mode)
  const { data: originalExecution } = useWorkflowExecution(!builderMode ? (originalWorkflowId ?? '') : '');
  const { data: originalTask } = useTaskByWorkflowId(!builderMode ? (originalWorkflowId ?? '') : '');
  const originalExecResult = (originalExecution?.result as any)?.data as Record<string, unknown> | undefined;

  const originalEnvelope = useMemo(() => {
    if (builderMode || !originalTask?.envelope) return null;
    try { return typeof originalTask.envelope === 'string' ? JSON.parse(originalTask.envelope) : originalTask.envelope; }
    catch { return null; }
  }, [builderMode, originalTask?.envelope]);

  const resolvedPrompt = (originalEnvelope as any)?.data?.prompt ?? originalPrompt;

  if (!wf) return <p className="text-sm text-text-secondary animate-pulse">Loading...</p>;

  // Original output
  const originalOutput = !builderMode ? (
    originalExecResult?.result ??
    (typeof originalExecResult?.summary === 'string' ? extractJsonFromSummary(originalExecResult.summary) : null) ??
    originalResult?.result ??
    (typeof originalResult?.summary === 'string' ? extractJsonFromSummary(originalResult.summary) : null) ??
    originalResult
  ) : null;

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
      (e: any) => e.event_type === 'activity_task_completed' && e.is_system &&
        (e.attributes as any)?.result && Object.keys((e.attributes as any).result).length > 0,
    );
    deterministicInput = triggerEvent ? (triggerEvent.attributes as any).result : null;
  }

  return (
    <div>
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 min-w-0">
      {/* Left: results */}
      <div className="min-w-0 overflow-hidden">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="heading-2 mb-1">Test</h2>
            <p className="text-base text-text-secondary">
              {builderMode
                ? 'Run the pipeline with test inputs and review the results.'
                : 'Run the pipeline with test inputs and compare results against the original execution.'}
            </p>
          </div>
          <SecondaryAction icon={Play} label="Run Test" onClick={handleOpenSidebar} />
        </div>

        {builderMode ? (
          <TestResultsBuilder
            jobs={jobs}
            selectedRunId={selectedRunId}
            onSelectRun={selectRun}
            deterministicInput={deterministicInput}
            deterministicOutput={deterministicOutput}
            inputSchema={wf.input_schema}
            runLoading={runLoading}
            selectedRunExecution={selectedRunExecution}
          />
        ) : (
          <TestResultsComparison
            jobs={jobs}
            selectedRunId={selectedRunId}
            onSelectRun={selectRun}
            originalEnvelope={originalEnvelope}
            resolvedPrompt={resolvedPrompt}
            originalOutput={originalOutput}
            originalDurationMs={originalExecution?.duration_ms}
            deterministicInput={deterministicInput}
            deterministicOutput={deterministicOutput}
            inputSchema={wf.input_schema}
            runLoading={runLoading}
            selectedRunExecution={selectedRunExecution}
          />
        )}
      </div>

      {/* Right: test sidebar */}
      <div className="space-y-6">
        <div className="sticky top-6">
          <TestSidebar
            sidebarOpen={sidebarOpen}
            activeJobId={activeJobId}
            activitySteps={activitySteps}
            activityManifest={wf.activity_manifest}
            jobComplete={jobComplete}
            invokeJsonMode={invokeJsonMode}
            setInvokeJsonMode={setInvokeJsonMode}
            invokeJson={invokeJson}
            setInvokeJson={setInvokeJson}
            invokeFields={invokeFields}
            setInvokeFields={setInvokeFields}
            executeAs={executeAs}
            setExecuteAs={setExecuteAs}
            invokeError={invokeMutation.isError ? invokeMutation.error.message : undefined}
            invokePending={invokeMutation.isPending}
            onInvoke={handleInvoke}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      </div>
    </div>

    <WizardNav>
      <button onClick={onBack} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Back</button>
      {!builderMode && <button onClick={onAdvance} className="btn-primary text-xs">Next: Verify</button>}
    </WizardNav>
    </div>
  );
}
