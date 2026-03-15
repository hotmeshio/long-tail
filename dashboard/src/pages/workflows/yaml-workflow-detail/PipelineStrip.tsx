import { Link } from 'react-router-dom';
import { JsonViewer } from '../../../components/common/data/JsonViewer';
import type { ActivityManifestEntry } from '../../../api/types/yaml-workflows';
import { sourceLabel, sourceColor } from './helpers';

export function PipelineStrip({ activities, selectedIdx, onSelect }: {
  activities: ActivityManifestEntry[]; selectedIdx: number; onSelect: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {activities.map((a, idx) => {
        const isSelected = idx === selectedIdx;
        return (
          <div key={a.activity_id} className="flex items-center shrink-0">
            {idx > 0 && (
              <div className="w-4 h-px bg-surface-border mx-0.5" />
            )}
            <button
              type="button"
              onClick={() => onSelect(idx)}
              className="flex items-center gap-1.5 cursor-pointer"
            >
              <span
                className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 transition-colors ${
                  isSelected
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-sunken text-text-tertiary hover:bg-accent-muted hover:text-accent'
                }`}
              >
                {idx + 1}
              </span>
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ${
                  isSelected ? 'text-text-primary' : 'text-text-tertiary hover:text-text-primary'
                }`}
              >
                {a.title}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function StepDetail({ activity }: { activity: ActivityManifestEntry }) {
  const hasInputs = Object.keys(activity.input_mappings).length > 0;
  const hasOutputs = activity.output_fields.length > 0;
  const isLlm = activity.tool_source === 'llm';

  const serverId = activity.mcp_server_id || (activity.tool_source === 'db' ? 'db' : '');
  const toolDisplay = !isLlm && activity.mcp_tool_name
    ? `${serverId}/${activity.mcp_tool_name}`
    : null;
  const toolIsLinkable = !isLlm && activity.mcp_tool_name && serverId;

  return (
    <div className="pt-2 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h4 className="text-base font-medium text-text-primary">{activity.title}</h4>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${sourceColor(activity.tool_source)}`}>
          {sourceLabel(activity.tool_source)}
        </span>
      </div>

      {/* Identity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Mapped Workflow Topic</p>
          <p className="text-sm font-mono text-text-primary">{activity.topic}</p>
        </div>
        {toolDisplay && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Tool</p>
            {toolIsLinkable ? (
              <Link
                to={`/mcp/servers?search=${encodeURIComponent(activity.mcp_tool_name!)}`}
                className="text-sm font-mono text-accent hover:underline"
              >
                {toolDisplay}
              </Link>
            ) : (
              <p className="text-sm font-mono text-text-primary">{toolDisplay}</p>
            )}
          </div>
        )}
        {isLlm && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">Model</p>
            <p className="text-sm font-mono text-text-primary">{activity.model || 'gpt-4o-mini'}</p>
          </div>
        )}
      </div>

      {/* Input -> Output */}
      {(hasInputs || hasOutputs) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">
          {hasInputs && (
            <div className="border border-surface-border rounded-md p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Inputs</p>
              <div className="space-y-1.5">
                {Object.entries(activity.input_mappings).map(([k, v]) => (
                  <p key={k} className="text-xs font-mono text-text-secondary leading-relaxed">
                    <span className="text-text-primary">{k}</span>
                    <span className="text-text-tertiary mx-1.5">&larr;</span>
                    <span className="text-accent">{v}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {hasOutputs && (
            <div className="border border-surface-border rounded-md p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Outputs</p>
              <div className="space-y-1.5">
                {activity.output_fields.map((f) => (
                  <p key={f} className="text-xs font-mono text-text-secondary leading-relaxed">{f}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tool Arguments -- captured from the original execution */}
      {!isLlm && activity.tool_arguments && Object.keys(activity.tool_arguments).length > 0 && (
        <JsonViewer data={activity.tool_arguments} label="Default Arguments" variant="panel" />
      )}

      {/* LLM Prompt -- special treatment */}
      {isLlm && activity.prompt_template && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">Prompt Template</p>
          <pre className="p-4 bg-surface-sunken rounded-lg text-xs font-mono text-text-secondary whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
            {activity.prompt_template}
          </pre>
        </div>
      )}
    </div>
  );
}
