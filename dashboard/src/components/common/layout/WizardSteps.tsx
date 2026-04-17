/**
 * Reusable wizard step indicator — sticky at top on scroll.
 * Numbered-circle pattern for multi-step wizard flows.
 */

interface WizardStepsProps {
  labels: readonly string[];
  current: number;
  /** Highest step the user can navigate to */
  maxReachable: number;
  onStepClick: (step: number) => void;
}

export function WizardSteps({ labels, current, maxReachable, onStepClick }: WizardStepsProps) {
  return (
    <div className="sticky top-0 z-20 bg-surface/95 backdrop-blur-sm pb-6 pt-1 -mt-1">
      <div className="flex items-center gap-3">
        {labels.map((label, i) => {
          const s = i + 1;
          const isReachable = s <= maxReachable;
          return (
            <div key={s} className="flex items-center gap-2">
              {s > 1 && <div className={`w-8 h-px ${current >= s ? 'bg-accent' : 'bg-surface-border'}`} />}
              <button
                onClick={() => isReachable && onStepClick(s)}
                disabled={!isReachable}
                className={`w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center transition-colors ${
                  current === s
                    ? 'bg-accent text-text-inverse'
                    : isReachable
                      ? 'bg-accent/20 text-accent cursor-pointer hover:bg-accent/30'
                      : 'bg-surface-sunken text-text-tertiary cursor-default'
                }`}
              >
                {s}
              </button>
              <span className={`text-xs ${current === s ? 'text-text-primary font-medium' : 'text-text-tertiary'}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
