/**
 * Sticky bottom navigation bar for wizard flows.
 * Pins Back/Next buttons to the bottom of the viewport.
 */

interface WizardNavProps {
  children: React.ReactNode;
}

export function WizardNav({ children }: WizardNavProps) {
  return (
    <div className="sticky bottom-0 bg-surface/95 backdrop-blur-sm border-t border-surface-border -mx-page-x px-page-x pt-3 pb-5 z-20 flex justify-between items-center mt-8">
      {children}
    </div>
  );
}
