import { useWorkflowConfigs } from '../../../api/workflows';
import { useYamlWorkflows } from '../../../api/yaml-workflows';
import { CapabilityCombobox } from './CapabilityCombobox';

const LABELS: Record<string, string> = {
  durable: 'Workflow',
  pipeline: 'Pipeline',
  capability: 'Capability',
  mcp_query: 'MCP Query',
};

const ALL_TYPES = ['durable', 'pipeline', 'capability', 'mcp_query'] as const;

export interface ReactionSelectorProps {
  reactionType: string;
  onReactionTypeChange: (type: string) => void;
  workflowType: string;
  onWorkflowTypeChange: (v: string) => void;
  pipelineId: string;
  onPipelineIdChange: (v: string) => void;
  serverId: string;
  toolName: string;
  onCapabilityChange: (serverId: string, toolName: string) => void;
  mcpPrompt?: string;
  onMcpPromptChange?: (v: string) => void;
  availableTypes?: typeof ALL_TYPES[number][];
}

export function ReactionSelector({
  reactionType,
  onReactionTypeChange,
  workflowType,
  onWorkflowTypeChange,
  pipelineId,
  onPipelineIdChange,
  serverId,
  toolName,
  onCapabilityChange,
  mcpPrompt,
  onMcpPromptChange,
  availableTypes = [...ALL_TYPES],
}: ReactionSelectorProps) {
  const { data: configs } = useWorkflowConfigs();
  const invocableWorkflows = (configs ?? []).filter((c: any) => c.invocable).map((c: any) => c.workflow_type as string);
  const { data: pipelineData } = useYamlWorkflows({ status: 'active' });
  const pipelines = (pipelineData?.workflows ?? []).map((w: any) => ({ id: w.id as string, name: (w.graph_topic || w.id) as string }));

  return (
    <div className="space-y-4">
      {/* Type tabs */}
      <div className="flex gap-1">
        {availableTypes.map((rt) => {
          const active = reactionType === rt;
          return (
            <button
              key={rt}
              type="button"
              onClick={() => onReactionTypeChange(rt)}
              className={`px-3 py-1.5 text-2xs font-medium rounded-md transition-colors ${
                active
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              {LABELS[rt]}
            </button>
          );
        })}
      </div>

      {/* Target selector per type */}
      {reactionType === 'durable' && (
        <div>
          <label className="label">Workflow *</label>
          <select value={workflowType} onChange={(e) => onWorkflowTypeChange(e.target.value)} className="input">
            <option value="">Select workflow...</option>
            {invocableWorkflows.map((wt) => <option key={wt} value={wt}>{wt}</option>)}
          </select>
        </div>
      )}

      {reactionType === 'pipeline' && (
        <div>
          <label className="label">Pipeline *</label>
          <select value={pipelineId} onChange={(e) => onPipelineIdChange(e.target.value)} className="input">
            <option value="">Select pipeline...</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {reactionType === 'capability' && (
        <div>
          <label className="label">Capability *</label>
          <CapabilityCombobox
            serverId={serverId}
            toolName={toolName}
            onChange={onCapabilityChange}
          />
        </div>
      )}

      {reactionType === 'mcp_query' && onMcpPromptChange && (
        <div>
          <label className="label">Prompt *</label>
          <textarea
            value={mcpPrompt ?? ''}
            onChange={(e) => onMcpPromptChange(e.target.value)}
            placeholder="Analyze the error and suggest remediation..."
            rows={3}
            className="input resize-none"
          />
        </div>
      )}
    </div>
  );
}
