import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { extractLinkVarNames } from '../lib/link-vars';
import { useLinkVariables } from './useLinkVariables';

/**
 * Guard for direct navigation carrying a raw `{lt:name}` placeholder (a
 * shared link, an old bookmark). Substitutes against this device's bindings
 * (or drops the facet) and rewrites the address bar with `replace` — the URL
 * never stays templated, and an unset variable simply widens the query.
 */
export function useResolveLinkVarUrl(): void {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { resolveUrl } = useLinkVariables();

  useEffect(() => {
    const url = pathname + search;
    if (extractLinkVarNames(url).length === 0) return;
    const resolved = resolveUrl(url);
    if (resolved !== url) navigate(resolved, { replace: true });
  }, [pathname, search, resolveUrl, navigate]);
}
