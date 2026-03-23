import { Check, Circle, Loader2 } from 'lucide-react';

export type LifecycleStep = 'query' | 'review' | 'compile' | 'deploy' | 'test';

interface Props {
  currentStep: LifecycleStep;
  completedSteps: Set<LifecycleStep>;
  onStepClick?: (step: LifecycleStep) => void;
}

const STEPS: Array<{ key: LifecycleStep; label: string; description: string }> = [
  { key: 'query', label: 'Query', description: 'Dynamic MCP execution' },
  { key: 'review', label: 'Review', description: 'Verify results' },
  { key: 'compile', label: 'Compile', description: 'Generate YAML workflow' },
  { key: 'deploy', label: 'Deploy', description: 'Activate deterministic flow' },
  { key: 'test', label: 'Test', description: 'Verify deterministic execution' },
];

export function QueryLifecycleSidebar({ currentStep, completedSteps, onStepClick }: Props) {
  return (
    <div className="w-56 shrink-0">
      <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-4">
        Lifecycle
      </h3>
      <ol className="space-y-1">
        {STEPS.map((step, i) => {
          const isComplete = completedSteps.has(step.key);
          const isCurrent = currentStep === step.key;
          const isClickable = isComplete || isCurrent;

          return (
            <li key={step.key}>
              <button
                onClick={() => isClickable && onStepClick?.(step.key)}
                disabled={!isClickable}
                className={`w-full flex items-start gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                  isCurrent
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : isComplete
                      ? 'text-text-secondary hover:bg-surface-sunken'
                      : 'text-text-tertiary cursor-default'
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {isComplete ? (
                    <Check className="w-4 h-4 text-status-success" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                </span>
                <span>
                  <span className="text-sm font-medium block leading-tight">{step.label}</span>
                  <span className="text-xs text-text-tertiary">{step.description}</span>
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`ml-[19px] w-px h-3 ${isComplete ? 'bg-status-success' : 'bg-border'}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
