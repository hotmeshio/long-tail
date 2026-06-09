import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useControlPlaneApps } from '../api/controlplane';

/**
 * Namespace-first hook. Queries available HotMesh namespaces,
 * auto-selects the first one if no URL param, and keeps the URL
 * in sync. Uses replaceState (not pushState) to avoid history spam.
 */
export function useNamespace(paramName = 'namespace') {
  const [params, setParams] = useSearchParams();
  const { data: apps, isLoading } = useControlPlaneApps();

  const selected = params.get(paramName) || '';
  const available = (apps?.apps ?? []).map((a) => a.appId).sort();

  useEffect(() => {
    if (!selected && available.length > 0 && !isLoading) {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set(paramName, available[0]);
        return next;
      }, { replace: true });
    }
  }, [selected, available.length, isLoading]);

  const setNamespace = (ns: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(paramName, ns);
      return next;
    });
  };

  return { namespace: selected || available[0] || '', available, isLoading, setNamespace };
}
