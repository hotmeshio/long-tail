interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function StepIndicator({ steps, currentStep, onStepClick }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-1 pb-4 border-b border-surface-border mb-4">
      {steps.map((label, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        const clickable = !!onStepClick;
        return (
          <div key={label} className="flex items-center gap-1">
            {i > 0 && (
              <div className={`w-4 h-px ${done ? 'bg-accent' : 'bg-surface-border'}`} />
            )}
            <button
              type="button"
              onClick={clickable ? () => onStepClick(i) : undefined}
              className={`flex items-center gap-1 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span
                className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 transition-colors ${
                  active
                    ? 'bg-accent text-text-inverse'
                    : done
                      ? 'bg-accent-muted text-accent'
                      : 'bg-surface-sunken text-text-tertiary'
                } ${clickable && !active ? 'hover:bg-accent-muted hover:text-accent' : ''}`}
              >
                {i + 1}
              </span>
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ${
                  active ? 'text-text-primary' : 'text-text-tertiary'
                } ${clickable && !active ? 'hover:text-text-primary' : ''}`}
              >
                {label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
