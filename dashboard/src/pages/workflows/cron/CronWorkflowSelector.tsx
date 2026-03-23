import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { describeCron } from './helpers';
import type { LTWorkflowConfig } from '../../../api/types/workflows';

interface CronWorkflowSelectorProps {
  workflows: LTWorkflowConfig[];
  selectedType: string;
  activeTypes: Set<string>;
  onSelect: (workflowType: string) => void;
}

export function CronWorkflowSelector({
  workflows,
  selectedType,
  activeTypes,
  onSelect,
}: CronWorkflowSelectorProps) {
  return (
    <div>
      <SectionLabel className="mb-6">Invocable Workflows</SectionLabel>
      <div>
        {workflows.map((config) => {
          const isSelected = selectedType === config.workflow_type;
          const hasCron = !!config.cron_schedule;
          const isActive = activeTypes.has(config.workflow_type);
          return (
            <button
              key={config.workflow_type}
              onClick={() => onSelect(config.workflow_type)}
              className={`w-full text-left py-4 border-b border-surface-border transition-colors duration-150 ${
                isSelected
                  ? 'border-l-2 border-l-accent pl-4'
                  : 'pl-0 hover:text-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <p className={`text-sm font-mono ${isSelected ? 'font-medium text-accent' : 'text-text-secondary'}`}>
                  {config.workflow_type}
                </p>
                {hasCron && (
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isActive ? 'bg-status-success' : 'bg-status-warning'
                  }`} />
                )}
              </div>
              {hasCron ? (
                <p className="text-[11px] font-mono text-text-tertiary mt-1">
                  {config.cron_schedule}
                  {describeCron(config.cron_schedule!) && (
                    <span className="font-sans ml-2 text-text-tertiary/60">
                      {describeCron(config.cron_schedule!)}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-[11px] text-text-tertiary/50 mt-1">No schedule</p>
              )}
              {config.description && (
                <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">
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
