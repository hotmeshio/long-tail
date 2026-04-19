import { Rocket, CheckCircle, Loader2 } from 'lucide-react';

import { WizardNav } from '../../../components/common/layout/WizardNav';
import { StatusBadge } from '../../../components/common/display/StatusBadge';
import {
  useYamlWorkflow,
  useDeployYamlWorkflow,
  useActivateYamlWorkflow,
} from '../../../api/yaml-workflows';

interface DeployPanelProps {
  yamlWorkflowId: string;
  onBack: () => void;
  onNext: () => void;
}

export function DeployPanel({ yamlWorkflowId, onBack, onNext }: DeployPanelProps) {
  const { data: workflow, refetch } = useYamlWorkflow(yamlWorkflowId);
  const deployMutation = useDeployYamlWorkflow();
  const activateMutation = useActivateYamlWorkflow();

  const status = workflow?.status || 'draft';
  const isDeployed = status === 'deployed' || status === 'active';
  const isActive = status === 'active';

  const handleDeploy = async () => {
    await deployMutation.mutateAsync(yamlWorkflowId);
    refetch();
  };

  const handleActivate = async () => {
    await activateMutation.mutateAsync(yamlWorkflowId);
    refetch();
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Rocket className="w-4 h-4 text-status-warning" strokeWidth={1.5} />
        <h2 className="text-sm font-semibold text-text-primary">Deploy</h2>
      </div>
      <p className="text-xs text-text-tertiary mb-6">
        Deploy and activate the workflow to make it available for execution.
      </p>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary w-20">Status</span>
          <StatusBadge status={status} />
        </div>

        {workflow && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-secondary w-20">Name</span>
            <span className="text-xs font-mono text-text-primary">{workflow.name}</span>
          </div>
        )}

        <div className="flex gap-2 mt-6">
          {!isDeployed && (
            <button
              onClick={handleDeploy}
              disabled={deployMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {deployMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Rocket className="w-3 h-3" />
              )}
              Deploy
            </button>
          )}

          {isDeployed && !isActive && (
            <button
              onClick={handleActivate}
              disabled={activateMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-status-success/10 text-status-success rounded-md hover:bg-status-success/20 transition-colors disabled:opacity-50"
            >
              {activateMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCircle className="w-3 h-3" />
              )}
              Activate
            </button>
          )}

          {isActive && (
            <div className="flex items-center gap-2 text-xs text-status-success">
              <CheckCircle className="w-4 h-4" />
              Workflow is active and ready for testing
            </div>
          )}
        </div>
      </div>

      <WizardNav>
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          &larr; Review
        </button>
        {isActive && (
          <button
            onClick={onNext}
            className="px-3 py-1.5 text-xs font-medium bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors"
          >
            Test &rarr;
          </button>
        )}
      </WizardNav>
    </div>
  );
}
