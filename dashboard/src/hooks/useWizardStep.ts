import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Manage wizard step via URL search param for deep-linkable browser history.
 *
 * Returns [manualStep, setStep, syncToUrl]:
 *   - manualStep: the step explicitly chosen by the user (click or deep-link),
 *     null when auto-step is driving.
 *   - setStep: user-initiated step change (pushes history).
 *   - syncToUrl: mirror the resolved step to the address bar (replace, no history).
 */
export function useWizardStep(): [
  number | null,
  (step: number | null) => void,
  (step: number) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();

  // On mount: if ?step=N was in the URL, treat as a deep link (user-initiated).
  // After mount, only explicit setStep calls mark it as user-chosen.
  const initialUrlStep = useRef<number | null | undefined>(undefined);
  if (initialUrlStep.current === undefined) {
    const raw = searchParams.get('step');
    initialUrlStep.current = raw ? parseInt(raw, 10) : null;
  }

  const userChoseStep = useRef(initialUrlStep.current !== null);

  const current = searchParams.get('step');
  const manualStep = userChoseStep.current
    ? (current ? parseInt(current, 10) : null)
    : null;

  const setStep = useCallback((step: number | null) => {
    userChoseStep.current = step !== null;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (step === null) {
        next.delete('step');
      } else {
        next.set('step', String(step));
      }
      return next;
    }, { replace: false });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  const syncToUrl = useCallback((step: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', String(step));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return [manualStep, setStep, syncToUrl];
}
