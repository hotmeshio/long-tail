import { useNavigate } from 'react-router-dom';

import { PageHeader } from '../../../components/common/layout/PageHeader';
import { WizardSteps } from '../../../components/common/layout/WizardSteps';

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

export function McpQueryDetailPage() {
  const navigate = useNavigate();
  const d = useQueryDetail();

  return (
    <div className="flex flex-col min-h-[calc(100vh-12rem)]">
      <PageHeader
        title="Compilation Wizard"
        actions={
          <button onClick={() => navigate('/mcp/queries')} className="text-sm text-text-secondary hover:text-text-primary">
            Back to list
          </button>
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
          onNext={() => d.setManualStep(2)}
        />
      )}

      {d.step === 2 && (
        <TimelinePanel
          events={d.events}
          onBack={() => d.setManualStep(1)}
          onNext={() => d.setManualStep(3)}
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
          compileFeedback={d.compileFeedback}
          setCompileFeedback={d.setCompileFeedback}
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
