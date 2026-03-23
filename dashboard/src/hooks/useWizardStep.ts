import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Manage wizard step via URL search param for deep-linkable browser history.
 * Returns [currentStep, setStep] where step is synced to ?step=N in the URL.
 * When step param is absent, returns null (caller should use autoStep).
 */
export function useWizardStep(): [number | null, (step: number | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const current = searchParams.get('step');
  const stepValue = current ? parseInt(current, 10) : null;

  const setStep = useCallback((step: number | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (step === null) {
        next.delete('step');
      } else {
        next.set('step', String(step));
      }
      return next;
    }, { replace: false }); // push to history for back/forward nav
  }, [setSearchParams]);

  return [stepValue, setStep];
}
