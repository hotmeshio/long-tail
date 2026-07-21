import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import { WizardSteps } from '../../../components/common/layout/WizardSteps';
import { useBuilderResult, useRefineBuildWorkflow } from '../../../api/workflow-builder';
import { useMcpQueryExecution } from '../../../api/mcp-query';
import { useYamlWorkflows, useYamlWorkflow } from '../../../api/yaml-workflows';
import { useMcpQueryDetailEvents } from '../../../hooks/useEventHooks';
import { DescribePanel } from '../../mcp/workflow-builder-detail/DescribePanel';
import { BuilderProfilePanel } from '../../mcp/workflow-builder-detail/BuilderProfilePanel';
import { DeployPanel } from './DeployPanel';
import { TestPanel } from './TestPanel';

export function BuilderWizard() {
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
        title="MCP Tool Designer"
        actions={
          <div className="flex items-center gap-3">
            <span className="text-2xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">Direct Build</span>
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
