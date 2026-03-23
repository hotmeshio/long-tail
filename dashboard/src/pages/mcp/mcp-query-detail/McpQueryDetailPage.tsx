import { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../../../components/common/layout/PageHeader';
import { WizardSteps } from '../../../components/common/layout/WizardSteps';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { CopyableId } from '../../../components/common/display/CopyableId';
import { TimeAgo } from '../../../components/common/display/TimeAgo';
import { useWorkflowDetailEvents } from '../../../hooks/useNatsEvents';
import { useWizardStep } from '../../../hooks/useWizardStep';
import { useMcpQueryExecution, useMcpQueryResult, useYamlWorkflowForSource, useDescribeMcpQuery } from '../../../api/mcp-query';
import { useCreateYamlWorkflow, useYamlWorkflowAppIds } from '../../../api/yaml-workflows';
import { useWorkflowExecution } from '../../../api/workflows';
import { useTaskByWorkflowId } from '../../../api/tasks';

import { mapStatus, extractJsonFromSummary, STEP_LABELS_BASE } from './helpers';
import type { Step } from './helpers';
import { OriginalQueryPanel } from './OriginalQueryPanel';
import { TimelinePanel } from './TimelinePanel';
import { ProfilePanel } from './ProfilePanel';
import { DeployPanel } from './DeployPanel';
import { TestPanel } from './TestPanel';
import { VerifyPanel } from './VerifyPanel';

// ── Main component ──────────────────────────────────────────────────────────

export function McpQueryDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const [compileAppId, setCompileAppId] = useState('longtail');
  const [compileName, setCompileName] = useState('');
  const [compileSubscribes, setCompileSubscribes] = useState('');
  const [autoSubscribes, setAutoSubscribes] = useState(true);
  const [compileDescription, setCompileDescription] = useState('');
  const [compileTags, setCompileTags] = useState<string[]>([]);
  const [compileInitialized, setCompileInitialized] = useState(false);

  const { data: execution } = useMcpQueryExecution(workflowId);
  const { data: resultData } = useMcpQueryResult(workflowId);
  const { data: yamlSearch } = useYamlWorkflowForSource(workflowId);
  useWorkflowDetailEvents(workflowId);

  const createYaml = useCreateYamlWorkflow();
  const { data: appIdData } = useYamlWorkflowAppIds();

  // Original execution + task envelope (for Panel 1 and prompt extraction)
  const { data: originalExecution } = useWorkflowExecution(workflowId ?? '');
  const { data: originalTask } = useTaskByWorkflowId(workflowId ?? '');
  const originalEnvelope = useMemo(() => {
    if (!originalTask?.envelope) return null;
    try { return typeof originalTask.envelope === 'string' ? JSON.parse(originalTask.envelope) : originalTask.envelope; }
    catch { return null; }
  }, [originalTask?.envelope]);
  const originalExecResult = (originalExecution?.result as any)?.data as Record<string, unknown> | undefined;

  const status = mapStatus(execution);
  const result = resultData?.result?.data as Record<string, unknown> | undefined;
  const discovery = (result?.discovery as Record<string, unknown>) || {};
  const events = execution?.events ?? [];

  // Extract original prompt: envelope > URL param > execution events
  const originalPrompt = useMemo(() => {
    const fromEnvelope = (originalEnvelope as any)?.data?.prompt;
    if (fromEnvelope) return fromEnvelope as string;
    const fromUrl = searchParams.get('prompt');
    if (fromUrl) return fromUrl;
    for (const e of events) {
      const attrs = e.attributes as Record<string, unknown>;
      if (attrs.activity_type === 'findCompiledWorkflows' && Array.isArray(attrs.input) && typeof (attrs.input as unknown[])[0] === 'string') {
        return (attrs.input as string[])[0];
      }
    }
    return undefined;
  }, [originalEnvelope, searchParams, events]);

  // Extract structured output from original execution
  const originalOutput = useMemo(() => {
    return originalExecResult?.result ??
      (typeof originalExecResult?.summary === 'string' ? extractJsonFromSummary(originalExecResult.summary) : null) ??
      result?.result ??
      (typeof result?.summary === 'string' ? extractJsonFromSummary(result.summary as string) : null) ??
      null;
  }, [originalExecResult, result]);

  const describePrompt = originalPrompt || (result?.title as string | undefined);
  const { data: describeData } = useDescribeMcpQuery({
    prompt: status === 'completed' ? describePrompt : undefined,
    resultTitle: result?.title as string | undefined,
    resultSummary: result?.summary as string | undefined,
  });

  const compiledYaml = yamlSearch?.workflows?.find(
    (w) => w.status === 'active' || w.status === 'deployed' || w.status === 'draft',
  );

  const autoStep: Step = useMemo(() => {
    if (status === 'in_progress' || status === 'pending') return 1;
    if (!result) return 1;
    if (!compiledYaml) return 2;
    if (compiledYaml.status === 'draft' || compiledYaml.status === 'deployed') return 4;
    return 5;
  }, [status, result, compiledYaml]);

  const [manualStep, setManualStep] = useWizardStep();
  const step = (manualStep as Step | null) ?? autoStep;
  const maxReachable: Step = compiledYaml?.status === 'active' ? 6 : autoStep >= 3 ? autoStep : (result ? 3 : autoStep) as Step;

  const stepLabels = useMemo((): string[] => {
    const labels: string[] = [...STEP_LABELS_BASE];
    if (compiledYaml?.status === 'active') labels[3] = 'Redeploy';
    return labels;
  }, [compiledYaml?.status]);

  // Pre-fill compile fields from LLM
  if (describeData && !compileInitialized) {
    setCompileInitialized(true);
    if (!compileDescription) setCompileDescription(describeData.description);
    if (compileTags.length === 0 && describeData.tags.length > 0) setCompileTags(describeData.tags);
  }
  if (result && !compileName) {
    const title = (result.title as string) || '';
    const slug = title.replace(/[—–]/g, '-').replace(/[^a-zA-Z0-9\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
    if (slug) { setCompileName(slug); if (autoSubscribes) setCompileSubscribes(slug); }
  }

  const derivedSubscribes = autoSubscribes ? compileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : compileSubscribes;
  const allAppIds = useMemo(() => appIdData?.app_ids ?? [], [appIdData?.app_ids]);

  const handleCompile = async () => {
    if (!workflowId || !compileName.trim() || !compileAppId.trim()) return;
    await createYaml.mutateAsync({
      workflow_id: workflowId, task_queue: 'long-tail-system', workflow_name: 'mcpQuery',
      name: compileName.trim(), description: compileDescription.trim() || undefined,
      app_id: compileAppId.trim(), subscribes: derivedSubscribes, tags: compileTags,
    });
    queryClient.invalidateQueries({ queryKey: ['yamlWorkflowForSource'], refetchType: 'all' });
    setManualStep(null);
  };

  // Determine the correct next step for profile panel navigation
  const profileNextStep = compiledYaml?.status === 'active' ? 5 : 4;

  return (
    <div className="flex flex-col min-h-[calc(100vh-12rem)]">
      <PageHeader
        title="Deterministic MCP Wizard"
        actions={
          <button onClick={() => navigate('/mcp/queries')} className="text-sm text-text-secondary hover:text-text-primary">
            Back to list
          </button>
        }
      />

      {/* Status card */}
      <div className="bg-surface-raised border border-surface-border rounded-md px-6 py-5 mb-6">
        <div className="flex items-center gap-4 mb-4">
          <StatusBadge status={status} />
          {discovery?.method === 'compiled-workflow' && (
            <span className="text-xs bg-status-success/10 text-status-success px-2 py-0.5 rounded-full">
              Deterministic ({((discovery.confidence as number) * 100).toFixed(0)}% match)
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-8">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Run ID</p>
            <CopyableId label="" value={workflowId ?? null} href={`/workflows/executions/${workflowId}`} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Duration</p>
            <p className="text-xs text-text-primary font-mono">
              {execution?.duration_ms != null ? `${(execution.duration_ms / 1000).toFixed(1)}s` : '\u2014'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Started</p>
            <p className="text-xs text-text-primary">
              {execution?.start_time ? <TimeAgo date={execution.start_time} /> : '\u2014'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-0.5">Tool Calls</p>
            <p className="text-xs text-text-primary">
              {typeof result?.tool_calls_made === 'number' ? result.tool_calls_made : '\u2014'}
            </p>
          </div>
        </div>
      </div>

      <WizardSteps labels={stepLabels} current={step} maxReachable={maxReachable} onStepClick={(s) => setManualStep(s as Step)} />

      {/* Panel content */}
      <div className="flex-1">

      {step === 1 && (
        <OriginalQueryPanel
          status={status}
          events={events}
          originalEnvelope={originalEnvelope}
          originalPrompt={originalPrompt}
          originalOutput={originalOutput}
          originalDurationMs={originalExecution?.duration_ms}
          resultSummary={result?.summary as string | undefined}
          onNext={() => setManualStep(2)}
        />
      )}

      {step === 2 && (
        <TimelinePanel
          events={events}
          onBack={() => setManualStep(1)}
          onNext={() => setManualStep(3)}
        />
      )}

      {step === 3 && (
        <ProfilePanel
          compiledYaml={compiledYaml}
          originalPrompt={originalPrompt}
          compileAppId={compileAppId}
          setCompileAppId={setCompileAppId}
          compileName={compileName}
          setCompileName={setCompileName}
          derivedSubscribes={derivedSubscribes}
          setCompileSubscribes={setCompileSubscribes}
          autoSubscribes={autoSubscribes}
          setAutoSubscribes={setAutoSubscribes}
          compileDescription={compileDescription}
          setCompileDescription={setCompileDescription}
          compileTags={compileTags}
          setCompileTags={setCompileTags}
          describeData={describeData}
          describePrompt={describePrompt}
          allAppIds={allAppIds}
          onCompile={handleCompile}
          isCompiling={createYaml.isPending}
          compileError={createYaml.isError ? createYaml.error.message : undefined}
          onBack={() => setManualStep(2)}
          onNext={() => setManualStep(profileNextStep as Step)}
        />
      )}

      {step === 4 && compiledYaml && (
        <DeployPanel
          yamlId={compiledYaml.id}
          onAdvance={() => setManualStep(5)}
          onBack={() => setManualStep(3)}
        />
      )}

      {step === 5 && compiledYaml && (
        <TestPanel
          yamlId={compiledYaml.id}
          originalWorkflowId={workflowId}
          originalResult={result}
          originalPrompt={originalPrompt}
          onBack={() => setManualStep(4)}
          onAdvance={() => setManualStep(6)}
        />
      )}

      {step === 6 && compiledYaml && (
        <VerifyPanel
          originalWorkflowId={workflowId}
          originalPrompt={originalPrompt}
          workflowName={compiledYaml.name}
          onBack={() => setManualStep(5)}
          onGoToDeploy={() => setManualStep(4)}
        />
      )}

      </div>{/* end flex-1 panel content */}
    </div>
  );
}
