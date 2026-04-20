import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { MessageSquare, Lightbulb, Layers, Hammer, Wand2 } from 'lucide-react';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { WizardSteps } from '../../../components/common/layout/WizardSteps';
import { useSubmitMcpQuery, useSubmitMcpQueryRouted, useMcpQueryExecution } from '../../../api/mcp-query';
import { useSubmitBuildWorkflow, useBuilderResult, useRefineBuildWorkflow } from '../../../api/workflow-builder';
import { useYamlWorkflows, useYamlWorkflow } from '../../../api/yaml-workflows';
import { useMcpQueryDetailEvents } from '../../../hooks/useEventHooks';
import { DescribePanel } from '../../mcp/workflow-builder-detail/DescribePanel';
import { BuilderProfilePanel } from '../../mcp/workflow-builder-detail/BuilderProfilePanel';

import type { Step } from './helpers';
import { useQueryDetail } from './useQueryDetail';
import { StatusCard } from './StatusCard';
import { OriginalQueryPanel } from './OriginalQueryPanel';
import { TimelinePanel } from './TimelinePanel';
import { ProfilePanel } from './ProfilePanel';
import { DeployPanel } from './DeployPanel';
import { TestPanel } from './TestPanel';
import { VerifyPanel } from './VerifyPanel';
import { EscalationBanner } from './EscalationBanner';

// ── Composer (shown for /mcp/queries/new) ─────────────────────────────────────

type DesignMode = 'discover' | 'direct';

const DISCOVER_STEPS = [
  { icon: MessageSquare, color: 'text-accent', title: 'Describe', detail: 'Write a prompt. The LLM executes tools dynamically to fulfill your request.' },
  { icon: Lightbulb, color: 'text-status-warning', title: 'Discover', detail: 'Review the execution trace — which tools were called, what data flowed between them.' },
  { icon: Layers, color: 'text-status-success', title: 'Compile', detail: 'Successful runs compile into deterministic pipelines. No LLM needed at runtime.' },
];

const DIRECT_STEPS = [
  { icon: MessageSquare, color: 'text-accent', title: 'Describe', detail: 'Specify what tools to use, what inputs to accept, and how data should flow between steps.' },
  { icon: Layers, color: 'text-status-warning', title: 'Review', detail: 'The LLM will create the pipeline (DAG) directly from tool schemas. Review the generated pipeline.' },
  { icon: Wand2, color: 'text-status-success', title: 'Deploy & Test', detail: 'Deploy, run with sample inputs, and refine until the pipeline works correctly.' },
];

function ComposerPanel() {
  const navigate = useNavigate();
  const [promptText, setPromptText] = useState('');
  const [mode, setMode] = useState<DesignMode>('discover');
  const [forceDiscovery, setForceDiscovery] = useState(true);
  const submitDirect = useSubmitMcpQuery();
  const submitRouted = useSubmitMcpQueryRouted();
  const submitBuilder = useSubmitBuildWorkflow();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = promptText.trim();
    if (!prompt) return;

    if (mode === 'direct') {
      const result = await submitBuilder.mutateAsync({ prompt });
      setPromptText('');
      navigate(`/mcp/queries/${result.workflow_id}?mode=builder`, { replace: true });
    } else {
      const mutation = forceDiscovery ? submitDirect : submitRouted;
      const result = await mutation.mutateAsync({ prompt });
      setPromptText('');
      if (forceDiscovery) {
        navigate(`/mcp/queries/${result.workflow_id}?step=2`, { replace: true });
      } else {
        navigate(`/workflows/executions/${result.workflow_id}`, { replace: true });
      }
    }
  };

  const activeMutation = mode === 'direct' ? submitBuilder
    : forceDiscovery ? submitDirect : submitRouted;
  const lifecycleSteps = mode === 'discover' ? DISCOVER_STEPS : DIRECT_STEPS;

  return (
    <div>
      <PageHeader title="Pipeline Designer" />
      <p className="text-sm text-text-secondary mb-6 leading-relaxed max-w-xl">
        Create deterministic pipelines from natural language. Choose how to get there.
      </p>

      {/* Mode toggle */}
      <div className="flex gap-1 mb-6 p-0.5 bg-surface-sunken rounded-lg w-fit">
        <button
          onClick={() => setMode('discover')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            mode === 'discover'
              ? 'bg-surface text-text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <Wand2 className="w-3 h-3" strokeWidth={1.5} />
          Discover & Compile
        </button>
        <button
          onClick={() => setMode('direct')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            mode === 'direct'
              ? 'bg-surface text-text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <Hammer className="w-3 h-3" strokeWidth={1.5} />
          Direct Build
        </button>
      </div>

      <div className="grid grid-cols-[1fr_240px] gap-6">
        <form onSubmit={handleSubmit}>
          <div className="rounded-lg border border-surface-border bg-surface-raised overflow-hidden h-full flex flex-col">
            <div className="flex items-start gap-3 flex-1">
              <MessageSquare className="w-4 h-4 text-accent shrink-0 mt-3.5 ml-4" strokeWidth={1.5} />
              <textarea
                ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = Math.min(400, Math.max(160, el.scrollHeight)) + 'px'; } }}
                value={promptText}
                onChange={(e) => {
                  setPromptText(e.target.value);
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = Math.min(400, Math.max(160, el.scrollHeight)) + 'px';
                }}
                placeholder={mode === 'discover'
                  ? 'Describe what you want to accomplish. The LLM will discover and execute the right tools...'
                  : 'Describe the pipeline steps, tools, inputs, and outputs. The LLM will create the pipeline (DAG) directly...'
                }
                className="flex-1 min-h-[160px] pr-4 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none border-none"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e); }}
              />
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-t border-surface-border bg-surface-sunken/30">
              {mode === 'discover' ? (
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={forceDiscovery}
                    onChange={(e) => setForceDiscovery(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-border text-accent-primary focus:ring-accent-primary/50 bg-surface-sunken cursor-pointer"
                  />
                  <span className="text-[10px] text-text-secondary group-hover:text-text-primary transition-colors">Force discovery</span>
                  <span className="text-[10px] text-text-tertiary">{forceDiscovery ? '— skip compiled pipelines' : '— prefer compiled pipelines'}</span>
                </label>
              ) : (
                <span className="text-[10px] text-text-tertiary">
                  LLM builds pipeline from tool schemas — no execution needed
                </span>
              )}
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-text-tertiary">Cmd+Enter</span>
                <button
                  type="submit"
                  disabled={!promptText.trim() || activeMutation.isPending}
                  className="px-4 py-1.5 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {activeMutation.isPending ? 'Starting...' : mode === 'discover' ? 'Discover' : 'Build'}
                </button>
              </div>
            </div>
          </div>
          {activeMutation.isError && (
            <p className="mt-2 text-sm text-status-error">{activeMutation.error.message}</p>
          )}
        </form>

        <div className="space-y-4 pt-1">
          {lifecycleSteps.map((step) => (
            <div key={step.title} className="flex items-start gap-2.5">
              <step.icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${step.color}`} strokeWidth={1.5} />
              <div>
                <p className="text-[11px] font-medium text-text-primary">{step.title}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Builder wizard (direct build mode) ────────────────────────────────────────

function BuilderWizard() {
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createdYamlId, setCreatedYamlId] = useState<string | null>(null);
  const refineMutation = useRefineBuildWorkflow();

  useMcpQueryDetailEvents(workflowId);

  const { data: resultData, refetch } = useBuilderResult(workflowId);
  const builderData = resultData?.result?.data as any;

  const hasYaml = !!builderData?.yaml;
  const isClarification = !!builderData?.clarification_needed;
  const isBuilding = !resultData || (!hasYaml && !isClarification && !builderData?.title?.includes('Failed'));

  // Look up existing YAML workflow by name (survives page reload)
  const builderName = builderData?.name as string | undefined;
  const { data: existingYaml } = useYamlWorkflows(
    builderName ? { search: builderName, limit: 1 } : {},
  );
  const existingYamlId = existingYaml?.workflows?.[0]?.id;
  const resolvedYamlId = createdYamlId || existingYamlId || null;

  // Fetch YAML workflow status for step gating
  const { data: yamlWorkflow } = useYamlWorkflow(resolvedYamlId || '');
  const yamlStatus = yamlWorkflow?.status || 'draft';
  const isDeployedOrActive = yamlStatus === 'deployed' || yamlStatus === 'active';
  type BStep = 1 | 2 | 3 | 4;
  const BUILDER_LABELS = ['Describe', 'Profile', 'Deploy', 'Test'];

  let maxReachable: BStep = 1;
  if (hasYaml) maxReachable = 2;
  if (resolvedYamlId) maxReachable = 3;
  if (isDeployedOrActive) maxReachable = 4;

  const stepParam = searchParams.get('step');
  const [manualStep, setManualStep] = useState<BStep | null>(null);
  const defaultStep: BStep = hasYaml ? 2 : 1;
  const step: BStep = manualStep ?? (stepParam ? Math.min(Number(stepParam), maxReachable) as BStep : defaultStep);

  // Sync URL to reflect the resolved step when no step param is present
  useEffect(() => {
    if (!stepParam && resultData) {
      setSearchParams({ mode: 'builder', step: String(step) }, { replace: true });
    }
  }, [resultData, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStepClick = (s: number) => {
    if (s <= maxReachable) {
      setManualStep(s as BStep);
      setSearchParams({ mode: 'builder', step: String(s) });
    }
  };

  // Extract original prompt from the workflow execution events (same approach as DescribePanel)
  const { data: builderExecution } = useMcpQueryExecution(workflowId);
  const startEvent = builderExecution?.events?.find(
    (e: any) => e.event_type === 'workflow_execution_started',
  );
  const envelope = Array.isArray(startEvent?.attributes?.input)
    ? startEvent.attributes.input[0]
    : startEvent?.attributes?.input;
  const originalPrompt: string | undefined = envelope?.data?.prompt || envelope?.data?.question || undefined;

  // Builder-specific recompilation: submits feedback + prior YAML to the builder LLM,
  // which starts a new builder workflow. Navigate to it so the user sees build progress.
  const handleBuilderRegenerate = async (feedback: string) => {
    if (!builderData?.yaml || !originalPrompt) return;
    const result = await refineMutation.mutateAsync({
      prompt: originalPrompt,
      prior_yaml: yamlWorkflow?.yaml_content || builderData.yaml,
      feedback,
      tags: builderData.tags,
    });
    navigate(`/mcp/queries/${result.workflow_id}?mode=builder`, { replace: true });
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-12rem)]">
      <PageHeader
        title="Pipeline Designer"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">Direct Build</span>
            <StatusBadge status={isClarification ? 'pending' : isBuilding ? 'in_progress' : hasYaml ? 'completed' : 'failed'} />
          </div>
        }
      />

      <WizardSteps labels={BUILDER_LABELS} current={step} maxReachable={maxReachable} onStepClick={handleStepClick} />

      <div className="flex-1 mt-4">
        {step === 1 && (
          <DescribePanel
            workflowId={workflowId!}
            status={isClarification ? 'clarification' : isBuilding ? 'in_progress' : hasYaml ? 'completed' : 'failed'}
            builderData={builderData}
            onBuilt={() => { refetch(); setManualStep(2); }}
            onNext={() => handleStepClick(2)}
          />
        )}
        {step === 2 && hasYaml && (
          <BuilderProfilePanel
            builderData={builderData}
            resolvedYamlId={resolvedYamlId}
            originalPrompt={originalPrompt}
            onBack={() => handleStepClick(1)}
            onCreate={(yamlId) => {
              setCreatedYamlId(yamlId);
              handleStepClick(3);
            }}
            onNext={() => handleStepClick(3)}
          />
        )}
        {step === 3 && resolvedYamlId && (
          <DeployPanel
            yamlId={resolvedYamlId}
            onAdvance={() => handleStepClick(4)}
            onBack={() => handleStepClick(2)}
            onRegenerate={handleBuilderRegenerate}
            regeneratePending={refineMutation.isPending}
          />
        )}
        {step === 4 && resolvedYamlId && (
          <TestPanel
            yamlId={resolvedYamlId}
            originalWorkflowId={workflowId}
            originalResult={undefined}
            originalPrompt={originalPrompt}
            onBack={() => handleStepClick(3)}
            onAdvance={() => {}}
            builderMode
          />
        )}
      </div>
    </div>
  );
}

// ── Detail page (existing workflow or new composer) ───────────────────────────

export function McpQueryDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [searchParams] = useSearchParams();

  if (workflowId === 'new') return <ComposerPanel />;
  if (searchParams.get('mode') === 'builder') return <BuilderWizard />;

  return <McpQueryWizard />;
}

function McpQueryWizard() {
  const d = useQueryDetail();

  return (
    <div className="flex flex-col min-h-[calc(100vh-12rem)]">
      <PageHeader
        title="Compilation Wizard"
        actions={
          <div className="flex items-center gap-4">
            <StatusBadge status={d.status} />
            {d.discovery?.method === 'compiled-workflow' && (
              <span className="text-xs bg-status-success/10 text-status-success px-2 py-0.5 rounded-full">
                Deterministic ({((d.discovery.confidence as number) * 100).toFixed(0)}% match)
              </span>
            )}
          </div>
        }
      />

      <StatusCard
        workflowId={d.workflowId}
        status={d.status}
        discovery={d.discovery}
        execution={d.execution}
        result={d.result}
      />

      <EscalationBanner
        escalation={d.displayEscalation}
        isRoundsExhausted={d.isRoundsExhausted}
        diagnosis={(d.result as any)?.diagnosis as string | undefined}
        onRetryTriage={d.activeEscalation ? d.handleRetryTriage : undefined}
        isRetrying={d.claimMutation.isPending || d.resolveMutation.isPending}
        rerunWorkflowId={d.rerunWorkflowId}
      />

      <WizardSteps labels={d.stepLabels} current={d.step} maxReachable={d.maxReachable} onStepClick={(s) => d.setManualStep(s as Step)} />

      <div className="flex-1">

      {d.step === 1 && (
        <OriginalQueryPanel
          status={d.status}
          originalEnvelope={d.originalEnvelope}
          originalPrompt={d.originalPrompt}
          originalOutput={d.originalOutput}
          originalDurationMs={d.originalExecution?.duration_ms}
          resultSummary={d.result?.summary as string | undefined}
          onNext={d.maxReachable >= 2 ? () => d.setManualStep(2) : undefined}
        />
      )}

      {d.step === 2 && (
        <TimelinePanel
          events={d.events}
          onBack={() => d.setManualStep(1)}
          onNext={d.maxReachable >= 3 ? () => d.setManualStep(3) : undefined}
        />
      )}

      {d.step === 3 && (
        <ProfilePanel
          compiledYaml={d.compiledYaml}
          originalPrompt={d.originalPrompt}
          compileAppId={d.compileAppId}
          setCompileAppId={d.setCompileAppId}
          compileName={d.compileName}
          setCompileName={d.setCompileName}
          compileDescription={d.compileDescription}
          setCompileDescription={d.setCompileDescription}
          compileTags={d.compileTags}
          setCompileTags={d.setCompileTags}
          describeData={d.describeData}
          describePrompt={d.describePrompt}
          allAppIds={d.allAppIds}
          onCompile={d.handleCompile}
          isCompiling={d.createYaml.isPending}
          compileError={d.createYaml.isError ? d.createYaml.error.message : undefined}
          isUncompilable={d.isUncompilable}
          onBack={() => d.setManualStep(2)}
          onNext={() => d.setManualStep(d.profileNextStep as Step)}
        />
      )}

      {d.step === 4 && d.compiledYaml && (
        <DeployPanel
          yamlId={d.compiledYaml.id}
          onAdvance={() => d.setManualStep(5)}
          onBack={() => d.setManualStep(3)}
        />
      )}

      {d.step === 5 && d.compiledYaml && (
        <TestPanel
          yamlId={d.compiledYaml.id}
          originalWorkflowId={d.workflowId}
          originalResult={d.result}
          originalPrompt={d.originalPrompt}
          onBack={() => d.setManualStep(4)}
          onAdvance={() => d.setManualStep(6)}
        />
      )}

      {d.step === 6 && d.compiledYaml && (
        <VerifyPanel
          originalWorkflowId={d.workflowId}
          originalPrompt={d.originalPrompt}
          workflowName={d.compiledYaml.name}
          onBack={() => d.setManualStep(5)}
          onGoToDeploy={() => d.setManualStep(4)}
        />
      )}

      </div>{/* end flex-1 panel content */}
    </div>
  );
}
