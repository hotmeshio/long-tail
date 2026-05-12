import { Bot, Clock } from 'lucide-react';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { WorkflowPill } from '../../../components/common/display/WorkflowPill';
import type { LTWorkflowConfig } from '../../../api/types';
import type { WorkflowTier } from '../../../api/types';

export function WorkflowSelector({
  configs,
  selectedType,
  onSelect,
  tierMap,
  activeTypes,
}: {
  configs: LTWorkflowConfig[];
  selectedType: string;
  onSelect: (config: LTWorkflowConfig) => void;
  tierMap: Map<string, WorkflowTier>;
  activeTypes?: Set<string>;
}) {
  return (
    <div>
      <SectionLabel className="mb-4">Select Workflow</SectionLabel>
      <div>
        {configs.map((config) => {
          const isSelected = selectedType === config.workflow_type;
          const tier = tierMap.get(config.workflow_type) ?? 'durable';
          const variant = tier === 'certified' ? 'certified' : tier === 'configured' ? 'configured' : 'durable';
          return (
            <button
              key={config.workflow_type}
              onClick={() => onSelect(config)}
              className={`w-full text-left px-6 py-3.5 border-b border-surface-border/50 transition-colors duration-150 ${
                isSelected
                  ? 'border-l-2 border-l-accent'
                  : 'hover:bg-surface-hover/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <WorkflowPill type={config.workflow_type} size="md" variant={variant} />
                {activeTypes?.has(config.workflow_type) && (
                  <span title="Cron schedule active"><Clock className="w-3 h-3 text-status-success/70 shrink-0" /></span>
                )}
                {config.execute_as && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] bg-accent/10 text-accent rounded">
                    <Bot className="w-2.5 h-2.5" />
                    {config.execute_as}
                  </span>
                )}
              </div>
              {config.description && (
                <p className="text-[10px] text-text-quaternary mt-1 leading-snug">
                  {config.description}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
