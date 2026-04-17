/**
 * Sticky bottom navigation bar for wizard flows.
 * Pins Back/Next buttons to the bottom of the viewport.
 */

interface WizardNavProps {
  children: React.ReactNode;
}

export function WizardNav({ children }: WizardNavProps) {
  return (
    <div className="sticky bg-surface/95 backdrop-blur-sm border-t border-surface-border -mx-10 px-10 pt-3 pb-5 z-20 flex justify-between items-center mt-8" style={{ bottom: 'calc(var(--feed-height, 0px) - 8px)' }}>
      {children}
    </div>
  );
}
