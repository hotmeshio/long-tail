import { useMemo } from 'react';

import { useLabelTemplates } from '../../api/labels';
import { useScanSchemes, SCAN_SCHEME_KINDS } from '../../api/scan-codes';

/**
 * Enabled templates on identity schemes: the badges a credential issuer can
 * print. With `identityKey`, only templates whose scheme binds that key.
 */
export function useBadgeTemplates(identityKey?: string) {
  const { data: schemes } = useScanSchemes();
  const { data } = useLabelTemplates();
  return useMemo(() => {
    const identity = new Set((schemes?.schemes ?? [])
      .filter((s) => s.kind === SCAN_SCHEME_KINDS.IDENTITY && s.enabled && (!identityKey || s.target_facet === identityKey))
      .map((s) => s.version));
    return (data?.templates ?? []).filter((t) => t.enabled && identity.has(t.scheme_version));
  }, [schemes, data, identityKey]);
}
