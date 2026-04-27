import { Bot, ShieldCheck, Settings, Workflow } from 'lucide-react';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import type { LTWorkflowConfig } from '../../../api/types';
import type { WorkflowTier } from '../../../api/types';

export function WorkflowSelector({
  configs,
  selectedType,
  onSelect,
  tierMap,
}: {
  configs: LTWorkflowConfig[];
  selectedType: string;
  onSelect: (config: LTWorkflowConfig) => void;
  tierMap: Map<string, WorkflowTier>;
}) {
  return (
    <div>
      <SectionLabel className="mb-6">Select Workflow</SectionLabel>
      <div>
        {configs.map((config) => {
          const isSelected = selectedType === config.workflow_type;
          const tier = tierMap.get(config.workflow_type) ?? 'durable';
          return (
            <button
              key={config.workflow_type}
              onClick={() => onSelect(config)}
              className={`w-full text-left py-4 border-b border-surface-border transition-colors duration-150 ${
                isSelected
                  ? 'border-l-2 border-l-accent pl-4'
                  : 'pl-0 hover:text-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                {tier === 'certified' && <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-status-success" />}
                {tier === 'configured' && <Settings className="w-3.5 h-3.5 shrink-0 text-status-info" />}
                {tier === 'durable' && <Workflow className="w-3.5 h-3.5 shrink-0 text-accent/75" />}
                <p className={`text-sm font-mono ${isSelected ? 'font-medium text-accent' : 'text-text-secondary'}`}>
                  {config.workflow_type}
                </p>
                {config.execute_as && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] bg-accent/10 text-accent rounded">
                    <Bot className="w-2.5 h-2.5" />
                    {config.execute_as}
                  </span>
                )}
              </div>
              {config.description && (
                <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">
                  {config.description}
                </p>
              )}
              <p className="text-[10px] text-text-tertiary mt-1 opacity-60">
                {config.task_queue}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
