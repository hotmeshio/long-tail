import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { WizardSteps } from '../../../components/common/layout/WizardSteps';
import { useBuilderResult } from '../../../api/workflow-builder';

import { DescribePanel } from './DescribePanel';
import { ReviewPanel } from './ReviewPanel';
import { DeployPanel } from './DeployPanel';
import { TestPanel } from './TestPanel';

type Step = 1 | 2 | 3 | 4;
const STEP_LABELS = ['Describe', 'Review', 'Deploy', 'Test'];

function mapStatus(result: any): string {
  if (!result) return 'in_progress';
  const data = result?.result?.data;
  if (data?.clarification_needed) return 'clarification';
  if (data?.yaml) return 'completed';
  if (data?.title === 'Build Failed') return 'failed';
  return 'in_progress';
}

export default function WorkflowBuilderDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [manualStep, setManualStep] = useState<Step | null>(null);
  const [deployedYamlId, setDeployedYamlId] = useState<string | null>(null);

  const { data: resultData, refetch } = useBuilderResult(workflowId);
  const builderData = resultData?.result?.data as any;
  const status = mapStatus(resultData);

  // Determine max reachable step
  let maxReachable: Step = 1;
  if (status === 'completed' && builderData?.yaml) maxReachable = 2;
  if (deployedYamlId) maxReachable = 4;

  // Auto-advance when build completes
  const stepParam = searchParams.get('step');
  const step: Step = manualStep ?? (stepParam ? Math.min(Number(stepParam), maxReachable) as Step : Math.min(maxReachable, 2) as Step);

  useEffect(() => {
    if (status === 'completed' && !manualStep && !stepParam) {
      setManualStep(2);
    }
  }, [status]);

  const handleStepClick = (s: number) => {
    if (s <= maxReachable) {
      setManualStep(s as Step);
      setSearchParams({ step: String(s) });
    }
  };

  if (!workflowId) return null;

  return (
    <div>
      <PageHeader
        title="Workflow Builder"
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge status={status === 'clarification' ? 'pending' : status} />
          </div>
        }
      />

      <WizardSteps
        labels={STEP_LABELS}
        current={step}
        maxReachable={maxReachable}
        onStepClick={handleStepClick}
      />

      <div className="mt-6">
        {step === 1 && (
          <DescribePanel
            workflowId={workflowId}
            status={status}
            builderData={builderData}
            onBuilt={() => { refetch(); setManualStep(2); }}
            onNext={() => handleStepClick(2)}
          />
        )}
        {step === 2 && (
          <ReviewPanel
            builderData={builderData}
            onBack={() => handleStepClick(1)}
            onDeploy={(yamlId) => { setDeployedYamlId(yamlId); handleStepClick(3); }}
          />
        )}
        {step === 3 && deployedYamlId && (
          <DeployPanel
            yamlWorkflowId={deployedYamlId}
            onBack={() => handleStepClick(2)}
            onNext={() => handleStepClick(4)}
          />
        )}
        {step === 4 && deployedYamlId && (
          <TestPanel
            yamlWorkflowId={deployedYamlId}
            sampleInputs={builderData?.sample_inputs}
            onBack={() => handleStepClick(3)}
          />
        )}
      </div>
    </div>
  );
}
