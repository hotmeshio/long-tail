/**
 * Sticky bottom navigation bar for wizard flows.
 * Pins Back/Next buttons to the bottom of the viewport.
 */

interface WizardNavProps {
  children: React.ReactNode;
}

export function WizardNav({ children }: WizardNavProps) {
  return (
    <div className="sticky bottom-0 bg-surface/95 backdrop-blur-sm border-t border-surface-border -mx-10 px-10 py-3 z-10 flex justify-between items-center mt-8">
      {children}
    </div>
  );
}
