import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Lightbulb, Layers } from 'lucide-react';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { WizardSteps } from '../../../components/common/layout/WizardSteps';
import { useSubmitMcpQuery, useSubmitMcpQueryRouted } from '../../../api/mcp-query';

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

const LIFECYCLE_STEPS = [
  { icon: MessageSquare, color: 'text-accent', title: '1. Describe', detail: 'Write a specific prompt. Mention tools, URLs, credentials, and expected outputs.' },
  { icon: Lightbulb, color: 'text-status-warning', title: '2. Discover', detail: 'MCP selects servers, calls tools, and chains results. You review the execution.' },
  { icon: Layers, color: 'text-status-success', title: '3. Compile', detail: 'Successful runs compile into deterministic pipelines. No LLM needed at runtime.' },
];

function ComposerPanel() {
  const navigate = useNavigate();
  const [promptText, setPromptText] = useState('');
  const [direct, setDirect] = useState(true);
  const submitDirect = useSubmitMcpQuery();
  const submitRouted = useSubmitMcpQueryRouted();
  const activeMutation = direct ? submitDirect : submitRouted;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = promptText.trim();
    if (!prompt) return;
    const result = await activeMutation.mutateAsync({ prompt });
    setPromptText('');
    if (direct) {
      navigate(`/mcp/queries/${result.workflow_id}?step=2`, { replace: true });
    } else {
      navigate(`/workflows/executions/${result.workflow_id}`, { replace: true });
    }
  };

  return (
    <div>
      <PageHeader title="Design Pipeline" />
      <p className="text-sm text-text-secondary mb-8 leading-relaxed max-w-xl">
        Describe a task and MCP discovers the right tools, executes the workflow, and compiles the result into a reusable pipeline.
      </p>

      <div className="grid grid-cols-[1fr_240px] gap-6">
        <form onSubmit={handleSubmit}>
          <div className="rounded-lg border border-surface-border bg-surface-raised overflow-hidden h-full flex flex-col">
            <div className="flex items-start gap-3 flex-1">
              <MessageSquare className="w-4 h-4 text-accent shrink-0 mt-3.5 ml-4" strokeWidth={1.5} />
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Describe what you want to accomplish. Be specific about which tools to use, what data to capture, and how results should be structured..."
                className="flex-1 min-h-[160px] pr-4 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none border-none"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e); }}
              />
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-t border-surface-border bg-surface-sunken/30">
              <label className="flex items-center gap-2 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={direct}
                  onChange={(e) => setDirect(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-border text-accent-primary focus:ring-accent-primary/50 bg-surface-sunken cursor-pointer"
                />
                <span className="text-[10px] text-text-secondary group-hover:text-text-primary transition-colors">Force discovery</span>
                <span className="text-[10px] text-text-tertiary">{direct ? '— skip compiled pipelines' : '— prefer compiled pipelines'}</span>
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-text-tertiary">Cmd+Enter</span>
                <button
                  type="submit"
                  disabled={!promptText.trim() || activeMutation.isPending}
                  className="px-4 py-1.5 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {activeMutation.isPending ? 'Starting...' : 'Design Pipeline'}
                </button>
              </div>
            </div>
          </div>
          {activeMutation.isError && (
            <p className="mt-2 text-sm text-status-error">{activeMutation.error.message}</p>
          )}
        </form>

        <div className="space-y-4 pt-1">
          {LIFECYCLE_STEPS.map((step) => (
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

// ── Detail page (existing workflow or new composer) ───────────────────────────

export function McpQueryDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();

  if (workflowId === 'new') return <ComposerPanel />;

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
