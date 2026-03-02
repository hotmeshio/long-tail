interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-1 pb-4 border-b border-surface-border mb-4">
      {steps.map((label, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={label} className="flex items-center gap-1">
            {i > 0 && (
              <div className={`w-4 h-px ${done ? 'bg-accent' : 'bg-surface-border'}`} />
            )}
            <div className="flex items-center gap-1">
              <span
                className={`w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0 ${
                  active
                    ? 'bg-accent text-text-inverse'
                    : done
                      ? 'bg-accent-muted text-accent'
                      : 'bg-surface-sunken text-text-tertiary'
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${
                  active ? 'text-text-primary' : 'text-text-tertiary'
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
