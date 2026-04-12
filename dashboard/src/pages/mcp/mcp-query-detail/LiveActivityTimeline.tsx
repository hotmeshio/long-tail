import type { ActivityManifestEntry } from '../../../api/types';
import type { ActivityStep } from '../../../hooks/useYamlActivityEvents';

const TOOL_SOURCE_COLORS: Record<string, { border: string; text: string; icon: string }> = {
  mcp:       { border: 'border-blue-500', text: 'text-blue-500', icon: 'MCP' },
  db:        { border: 'border-blue-500', text: 'text-blue-500', icon: 'DB' },
  llm:       { border: 'border-violet-500', text: 'text-violet-500', icon: 'LLM' },
  transform: { border: 'border-emerald-500', text: 'text-emerald-500', icon: 'Map' },
};

export function LiveActivityTimeline({
  steps,
  manifest,
  isComplete,
}: {
  steps: ActivityStep[];
  manifest: ActivityManifestEntry[];
  isComplete: boolean;
}) {
  const workerActivities = manifest.filter((a) => a.type === 'worker');
  const totalSteps = workerActivities.length;

  const merged = workerActivities.map((a, i) => {
    const live = steps.find((s) => s.activityId === a.activity_id);
    const source = a.tool_source || 'mcp';
    const colors = TOOL_SOURCE_COLORS[source] || TOOL_SOURCE_COLORS.mcp;
    return {
      activityId: a.activity_id,
      title: a.title || a.mcp_tool_name || a.activity_id,
      toolName: a.mcp_tool_name,
      toolSource: source,
      colors,
      stepIndex: i,
      status: live?.status || 'pending' as const,
      error: live?.error,
    };
  });

  return (
    <div>
      <p className="text-xs text-text-secondary mb-4">
        {isComplete
          ? `All ${totalSteps} steps completed`
          : `Running step ${merged.filter((s) => s.status === 'completed').length + 1} of ${totalSteps}...`}
      </p>

      <div className="space-y-0">
        {merged.map((step, idx) => {
          const isLast = idx === merged.length - 1;
          return (
            <div key={step.activityId} className="flex items-stretch gap-3">
              {/* Vertical track */}
              <div className="flex flex-col items-center w-5 shrink-0">
                <span className={`w-3 h-3 rounded-full shrink-0 border-2 transition-colors ${
                  step.status === 'completed' ? 'bg-status-success border-status-success'
                  : step.status === 'running' ? `${step.colors.border} bg-transparent animate-pulse`
                  : step.status === 'failed' ? 'bg-status-error border-status-error'
                  : 'bg-surface-sunken border-surface-border'
                }`} />
                {!isLast && (
                  <span className={`w-px flex-1 transition-colors ${
                    step.status === 'completed' ? 'bg-status-success/30' : 'bg-surface-border'
                  }`} />
                )}
              </div>

              {/* Step content */}
              <div className={`pb-4 ${isLast ? 'pb-0' : ''}`}>
                <p className={`text-xs font-medium ${
                  step.status === 'running' ? 'text-text-primary'
                  : step.status === 'completed' ? 'text-text-secondary'
                  : step.status === 'failed' ? 'text-status-error'
                  : 'text-text-tertiary'
                }`}>
                  {step.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[9px] font-mono px-1 py-0.5 rounded border ${step.colors.border} ${step.colors.text} bg-transparent`}>
                    {step.colors.icon}
                  </span>
                  {step.toolName && (
                    <span className="text-[10px] text-text-tertiary font-mono">{step.toolName}</span>
                  )}
                </div>
                {step.error && (
                  <p className="text-[10px] text-status-error mt-1">{step.error}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isComplete && (
        <p className="text-[10px] text-text-tertiary mt-3 text-center">Closing...</p>
      )}
    </div>
  );
}
