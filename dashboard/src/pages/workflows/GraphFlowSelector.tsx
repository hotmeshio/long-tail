import { Clock } from 'lucide-react';
import { SectionLabel } from '../../components/common/layout/SectionLabel';
import { ToolPill } from '../../components/common/display/ToolPill';
import { NamespacePill } from '../../components/common/display/NamespacePill';
import type { LTYamlWorkflowRecord } from '../../api/types';

export function GraphFlowSelector({
  flows,
  selectedId,
  onSelect,
}: {
  flows: LTYamlWorkflowRecord[];
  selectedId: string;
  onSelect: (flow: LTYamlWorkflowRecord) => void;
}) {
  return (
    <div>
      <SectionLabel className="mb-4">Select Flow</SectionLabel>
      <div>
        {flows.map((flow) => {
          const isSelected = selectedId === flow.id;
          return (
            <button
              key={flow.id}
              onClick={() => onSelect(flow)}
              className={`w-full text-left px-6 py-3.5 border-b border-surface-border/50 transition-colors duration-150 ${
                isSelected ? 'border-l-2 border-l-accent' : 'hover:bg-surface-hover/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <ToolPill name={flow.graph_topic} size="md" />
                <NamespacePill namespace={flow.app_id} />
                {flow.cron_schedule && (
                  <span title="Cron schedule active"><Clock className="w-3 h-3 text-status-success/70 shrink-0" /></span>
                )}
              </div>
              {flow.description && (
                <p className="text-[10px] text-text-quaternary mt-1 leading-snug">{flow.description}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
